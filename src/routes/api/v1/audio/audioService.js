import { getActiveProviderRows } from "@/lib/localDb.js";
import { proxyAwareFetch } from "@/utils/proxyFetch.js";
import { PROVIDERS } from "@/config/providers.js";

const KNOWN_AUDIO_PROVIDERS = [
  "openai", "groq", "cloudflare-ai", "elevenlabs", "cartesia", "deepgram", "ollama-local", "ollama"
];

export async function resolveAudioConnection(model, providerHint = null) {
  const rows = await getActiveProviderRows();
  if (!rows || rows.length === 0) {
    throw new Error("No active provider connection found");
  }

  let targetProvider = providerHint ? String(providerHint).toLowerCase() : "";
  let targetModel = String(model || "").trim();

  if (targetModel.includes("/")) {
    const parts = targetModel.split("/");
    targetProvider = parts[0].toLowerCase();
    targetModel = parts.slice(1).join("/");
  }

  let connection = null;
  if (targetProvider) {
    connection = rows.find(
      (r) =>
        String(r.provider || "").toLowerCase() === targetProvider ||
        String(r.name || "").toLowerCase() === targetProvider
    );
  }

  if (!connection) {
    for (const p of KNOWN_AUDIO_PROVIDERS) {
      connection = rows.find((r) => String(r.provider || "").toLowerCase() === p);
      if (connection) break;
    }
  }

  if (!connection) {
    connection = rows.find((r) => r.authType === "apikey" || r.providerSpecificData?.baseUrl);
  }

  if (!connection) {
    throw new Error("No suitable audio provider connection found");
  }

  const rawBase =
    connection.providerSpecificData?.baseUrl ||
    PROVIDERS[connection.provider]?.baseUrl ||
    (connection.provider === "openai" ? "https://api.openai.com/v1" : "");

  const baseUrl = String(rawBase)
    .replace(/\/chat\/completions\/?$/i, "")
    .replace(/\/messages\/?$/i, "")
    .replace(/\/llm\/responses\/?$/i, "")
    .replace(/\/$/, "");

  if (!baseUrl) {
    throw new Error(`Provider ${connection.provider} has no base URL configured`);
  }

  const token = connection.accessToken || connection.apiKey;
  const headers = {};
  if (token) headers["authorization"] = `Bearer ${token}`;

  return {
    connection,
    provider: connection.provider,
    model: targetModel,
    baseUrl,
    headers,
  };
}

export async function callAudioSpeech(body, request) {
  const resolved = await resolveAudioConnection(body.model, body.provider);
  const url = `${resolved.baseUrl}/audio/speech`;

  const payload = {
    model: resolved.model,
    input: body.input,
    voice: body.voice || "alloy",
    response_format: body.response_format || "mp3",
    ...(body.speed !== undefined ? { speed: body.speed } : {}),
  };

  const headers = {
    ...resolved.headers,
    "content-type": "application/json",
  };

  const response = await proxyAwareFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal: request.signal,
  });

  return response;
}

export async function callAudioTranscription(formData, request) {
  const model = formData.get("model");
  const provider = formData.get("provider");
  const resolved = await resolveAudioConnection(model, provider);
  const url = `${resolved.baseUrl}/audio/transcriptions`;

  const upstreamForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === "provider") continue;
    if (key === "model") {
      upstreamForm.append("model", resolved.model);
    } else {
      upstreamForm.append(key, value);
    }
  }

  const response = await proxyAwareFetch(url, {
    method: "POST",
    headers: resolved.headers,
    body: upstreamForm,
    signal: request.signal,
  });

  return response;
}

export async function callAudioTranslation(formData, request) {
  const model = formData.get("model");
  const provider = formData.get("provider");
  const resolved = await resolveAudioConnection(model, provider);
  const url = `${resolved.baseUrl}/audio/translations`;

  const upstreamForm = new FormData();
  for (const [key, value] of formData.entries()) {
    if (key === "provider") continue;
    if (key === "model") {
      upstreamForm.append("model", resolved.model);
    } else {
      upstreamForm.append(key, value);
    }
  }

  const response = await proxyAwareFetch(url, {
    method: "POST",
    headers: resolved.headers,
    body: upstreamForm,
    signal: request.signal,
  });

  return response;
}
