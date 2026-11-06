import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/errorConfig.js";

export function buildErrorBody(statusCode, message) {
  const errorInfo = ERROR_TYPES[statusCode] ||
    (statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" });

  return {
    error: {
      message: message || DEFAULT_ERROR_MESSAGES[statusCode] || "An error occurred",
      type: errorInfo.type,
      code: errorInfo.code
    }
  };
}

export function errorResponse(statusCode, message) {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export async function writeStreamError(writer, statusCode, message) {
  const errorBody = buildErrorBody(statusCode, message);
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(`data: ${JSON.stringify(errorBody)}\n\n`));
}

export function parseResetTimestamp(headerValue) {
  if (!headerValue || typeof headerValue !== "string") return null;
  const str = headerValue.trim();
  if (!str) return null;

  if (/^\d+(?:\.\d+)?\s*s$/i.test(str)) {
    const sec = parseFloat(str);
    if (Number.isFinite(sec) && sec > 0) return Date.now() + Math.round(sec * 1000);
  }
  if (/^\d+\s*ms$/i.test(str)) {
    const ms = parseInt(str, 10);
    if (Number.isFinite(ms) && ms > 0) return Date.now() + ms;
  }
  if (/^\d+(?:\.\d+)?$/.test(str)) {
    const val = parseFloat(str);
    if (!Number.isFinite(val) || val <= 0) return null;
    if (val > 1e9 && val < 1e11) {
      const ms = Math.round(val * 1000);
      return ms > Date.now() ? ms : null;
    }
    if (val >= 1e12) {
      return val > Date.now() ? Math.round(val) : null;
    }
    return Date.now() + Math.round(val * 1000);
  }

  const parsedDate = Date.parse(str);
  if (Number.isFinite(parsedDate) && parsedDate > Date.now()) {
    return parsedDate;
  }

  return null;
}

export function extractRateLimitReset(response, bodyText = "") {
  const headers = response?.headers;
  if (headers && typeof headers.get === "function") {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const ts = parseResetTimestamp(retryAfter);
      if (ts) return ts;
    }

    const xReset =
      headers.get("x-ratelimit-reset") ||
      headers.get("x-ratelimit-reset-requests") ||
      headers.get("x-ratelimit-reset-tokens");
    if (xReset) {
      const ts = parseResetTimestamp(xReset);
      if (ts) return ts;
    }
  }

  if (bodyText && typeof bodyText === "string") {
    try {
      const json = JSON.parse(bodyText);
      const err = json?.error || json;
      if (typeof err === "object" && err !== null) {
        if (typeof err.resets_at === "number" && err.resets_at > 0) {
          const ms = err.resets_at > 1e11 ? err.resets_at : err.resets_at * 1000;
          if (ms > Date.now()) return ms;
        }
        if (typeof err.resets_in_seconds === "number" && err.resets_in_seconds > 0) {
          return Date.now() + Math.round(err.resets_in_seconds * 1000);
        }
        if (typeof err.retry_after === "number" && err.retry_after > 0) {
          return Date.now() + Math.round(err.retry_after * 1000);
        }
      }
    } catch {}
  }

  return null;
}

export async function parseUpstreamError(response, executor = null) {
  let bodyText = "";
  try {
    bodyText = await response.text();
  } catch {
    bodyText = "";
  }

  let statusCode = response?.status || 500;
  let message = DEFAULT_ERROR_MESSAGES[statusCode] || "Upstream provider request failed";
  let resetsAtMs = extractRateLimitReset(response, bodyText);

  if (executor && typeof executor.parseError === "function") {
    try {
      const parsed = executor.parseError(response, bodyText);
      if (parsed && typeof parsed === "object") {
        if (parsed.status) statusCode = parsed.status;
        if (["codebuddy-cn", "codebuddy-intl"].includes(executor?.provider) && parsed.message) {
          message = parsed.message;
        } else if (parsed.message) {
          message = parsed.message;
        }
        if (parsed.resetsAtMs) resetsAtMs = parsed.resetsAtMs;
      }
    } catch {}
  }

  return {
    statusCode,
    message,
    resetsAtMs,
  };
}

export function classifyUnsupportedParameter(bodyText, ctx = {}) {
  if (bodyText == null) return null;

  if (ctx.status != null && ctx.status !== 400 && ctx.status !== 422) return null;
  const message = String(bodyText).toLowerCase();
  if (!message) return null;

  const m = message.match(
    /(?:unsupported parameter|parameter unsupported|unknown parameter|invalid parameter|unsupported field|unknown field|unrecognized (?:request argument|parameter))[:\s]+["'`]?([a-z][a-z0-9_.-]*)/i,
  );
  if (m?.[1] !== undefined) return _normalizeFieldPath(m[1]);

  const KNOWN = [
    "prompt_cache_options", "prompt_cache_breakpoint",
    "reasoning.max_tokens", "reasoning.effort", "reasoning",
    "reasoning_effort", "thinking",
    "output_config", "output_config.effort",
    "response_format", "parallel_tool_calls", "tool_choice", "stream_options",
  ];
  return KNOWN.find((field) => message.includes(field)) ?? null;
}

function _normalizeFieldPath(value) {
  return String(value).trim().toLowerCase().replace(/^["'`]|["'`]$/g, "");
}

export function createErrorResult(statusCode, message, resetsAtMs) {
  return {
    success: false,
    status: statusCode,
    error: message,
    resetsAtMs,
    response: errorResponse(statusCode, message)
  };
}

export function unavailableResponse(statusCode, message, retryAfter, retryAfterHuman) {
  const retryAfterSec = Math.max(Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000), 1);
  const msg = `${message} (${retryAfterHuman})`;
  return new Response(
    JSON.stringify({ error: { message: msg } }),
    {
      status: statusCode,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(retryAfterSec)
      }
    }
  );
}

export function formatProviderError(error, provider, model, statusCode) {
  const code = statusCode || error.code || "FETCH_FAILED";
  if (code === 401 || code === 403) return DEFAULT_ERROR_MESSAGES[code] || "Authentication failed";
  if (code === 429) return DEFAULT_ERROR_MESSAGES[code] || "Rate limit exceeded";
  if (code >= 500) return DEFAULT_ERROR_MESSAGES[code] || "Upstream provider request failed";
  return DEFAULT_ERROR_MESSAGES[code] || "Provider request failed";
}
