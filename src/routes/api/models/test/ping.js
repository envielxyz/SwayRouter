import { getActiveApiKey } from "@/lib/localDb";
import { RUNTIME_CONFIG } from "@/shared/constants/config";
import { MODEL_TEST_TIMEOUT_MS } from "@/config/runtimeConfig.js";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { callAudioSpeech, callAudioTranscription } from "@/routes/api/v1/audio/audioService.js";
const CLI_TOKEN_SALT = "swayrouter-cli-auth";

async function getInternalHeaders() {
  let apiKey = null;
  try {
    apiKey = await getActiveApiKey();
  } catch {}

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
  headers["x-swayrouter-cli-token"] = await getConsistentMachineId(CLI_TOKEN_SALT);
  return headers;
}

function streamContainsCompletion(rawText) {
  for (const line of String(rawText || "").split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const event = JSON.parse(payload);
      if (Array.isArray(event?.choices) && event.choices.some((choice) => {
        const delta = choice?.delta || {};
        return Boolean(
          typeof delta.content === "string" && delta.content.length > 0
          || typeof delta.reasoning === "string" && delta.reasoning.length > 0
          || typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0
          || choice?.finish_reason
        );
      })) return true;
    } catch {

    }
  }
  return false;
}

function extractProviderError(rawText) {
  const candidates = [];
  for (const line of String(rawText || "").split(/\r?\n/)) {
    const value = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!value || value === "[DONE]") continue;
    try {
      candidates.push(JSON.parse(value));
    } catch {

    }
  }

  for (const payload of candidates) {
    const nested = payload?.error;
    const message = typeof nested === "object"
      ? nested?.message || payload?.msg || payload?.message
      : nested || payload?.msg || payload?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  return null;
}

function buildProbeMessages(options) {
  if (options.probeFormat === "codebuddy-intl") {
    return [
      { role: "system", content: "Model test probe. Reply with a short confirmation." },
      { role: "user", content: [{ type: "text", text: "Reply with OK." }] },
    ];
  }
  return [{ role: "user", content: "hi" }];
}

export async function pingModelByKind(
  model,
  kind,
  baseUrl = `http://127.0.0.1:${process.env.PORT || RUNTIME_CONFIG.appPort}`,
  options = {},
) {
  const headers = await getInternalHeaders();
  if (options.connectionId) {
    headers["x-swayrouter-connection-id"] = options.connectionId;
  }
  if (options.stream === true) headers.Accept = "text/event-stream";
  const start = Date.now();
  if (kind !== "llm" && kind !== "tts" && kind !== "stt" && kind !== undefined && kind !== null) {
    return {
      ok: false,
      latencyMs: 0,
      status: 404,
      error: `Model kind "${kind}" is not supported`,
    };
  }

  const timeoutController = new AbortController();
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : MODEL_TEST_TIMEOUT_MS;
  const timeoutTimer = setTimeout(
    () => timeoutController.abort(new Error("model test timeout")),
    timeoutMs,
  );
  const callerSignal = options.signal;
  const signal = callerSignal
    ? AbortSignal.any([callerSignal, timeoutController.signal])
    : timeoutController.signal;

  let res;
  let rawText = "";
  const useStream = options.stream === true;
  try {
    if (kind === "tts") {
      res = await callAudioSpeech({ model, input: "ping" }, { signal });
      const latencyMs = Date.now() - start;
      clearTimeout(timeoutTimer);
      if (res.ok) {
        return { ok: true, latencyMs, status: res.status, error: null };
      }
      let errDetail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error?.message || errJson?.error) {
          errDetail = `${errDetail}: ${errJson.error.message || errJson.error}`;
        }
      } catch {}
      return { ok: false, latencyMs, status: res.status, error: errDetail };
    }

    if (kind === "stt") {
      const form = new FormData();
      const wav = Buffer.from("524946462c00000057415645666d74201000000001000100803e0000007d00000200100064617461080000000000000000000000", "hex");
      form.append("file", new Blob([wav], { type: "audio/wav" }), "test.wav");
      form.append("model", model);
      res = await callAudioTranscription(form, { signal });
      const latencyMs = Date.now() - start;
      clearTimeout(timeoutTimer);
      if (res.ok) {
        return { ok: true, latencyMs, status: res.status, error: null };
      }
      let errDetail = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        if (errJson?.error?.message || errJson?.error) {
          errDetail = `${errDetail}: ${errJson.error.message || errJson.error}`;
        }
      } catch {}
      return { ok: false, latencyMs, status: res.status, error: errDetail };
    }

    res = await fetch(`${baseUrl}/api/v1/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        max_tokens: options.probeFormat === "codebuddy-intl" ? 50 : 16,
        stream: useStream,
        messages: buildProbeMessages(options),
      }),
      signal,
    });

    rawText = await res.text();
  } catch (error) {
    console.error("[pingModelByKind] catch error:", error);
    const callerAborted = callerSignal?.aborted === true;
    const timedOut = timeoutController.signal.aborted && !callerAborted;
    if (callerAborted) throw error;
    if (timedOut || error?.name === "TimeoutError") {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        status: 504,
        error: `Model test timed out after ${timeoutMs}ms`,
      };
    }
    return {
      ok: false,
      latencyMs: Date.now() - start,
      status: 502,
      error: "Model test response closed before completion",
    };
  } finally {
    clearTimeout(timeoutTimer);
  }
  const latencyMs = Date.now() - start;
  if (useStream) {
    if (!res.ok) {
      const detail = extractProviderError(rawText);
      return {
        ok: false,
        latencyMs,
        error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
        status: res.status,
      };
    }
    return streamContainsCompletion(rawText)
      ? { ok: true, latencyMs, error: null, status: res.status }
      : {
        ok: false,
        latencyMs,
        error: extractProviderError(rawText) || `HTTP ${res.status}: provider returned no completion events`,
        status: res.status,
      };
  }
  let parsed = null;
  try { parsed = rawText ? JSON.parse(rawText) : null; } catch {}

  if (!res.ok) {
    const detail = extractProviderError(rawText);
    return {
      ok: false,
      latencyMs,
      error: detail ? `HTTP ${res.status}: ${detail}` : `HTTP ${res.status}`,
      status: res.status,
    };
  }

  const providerStatus = parsed?.status;
  const hasProviderErrorStatus = providerStatus !== undefined
    && providerStatus !== null
    && String(providerStatus) !== "200"
    && String(providerStatus) !== "0";
  if (hasProviderErrorStatus) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: "Provider returned an error",
    };
  }

  if (parsed?.error) {
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: "Provider returned an error",
    };
  }

  const hasSuccessfulEnvelope = parsed?.success === true
    && parsed?.data !== undefined
    && parsed?.data !== null;
  if (hasSuccessfulEnvelope) {
    return { ok: true, latencyMs, error: null, status: res.status };
  }

  const hasChoices = Array.isArray(parsed?.choices) && parsed.choices.length > 0;
  const hasUsableChoice = parsed?.choices?.some((choice) => {
    const message = choice?.message || {};
    return Boolean(
      typeof message.content === "string" && message.content.length > 0
      || typeof message.reasoning_content === "string" && message.reasoning_content.length > 0
      || Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      || choice?.finish_reason
    );
  });
  if (hasChoices && hasUsableChoice) {
    return { ok: true, latencyMs, error: null, status: res.status };
  }
  if (!hasChoices) {
    const keys = parsed && typeof parsed === "object"
      ? Object.keys(parsed).slice(0, 8).join(", ")
      : "non-JSON response";
    return {
      ok: false,
      latencyMs,
      status: res.status,
      error: `HTTP ${res.status}: provider returned no completion choices${keys ? ` (fields: ${keys})` : ""}`,
    };
  }

  return { ok: true, latencyMs, error: null, status: res.status };
}
