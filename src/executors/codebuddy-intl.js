import { DefaultExecutor } from "./default.js";

// Deterministic v5-shaped UUID from a session key (ports 9router PR #4928).
// Pure JS so it works on both node and bun runtimes.
function stableUuidFrom(key) {
  let s = "";
  for (let i = 0; i < 4; i++) {
    let x = 2166136261;
    const g = key + "\0" + i;
    for (let j = 0; j < g.length; j++) {
      x ^= g.charCodeAt(j);
      x = Math.imul(x, 16777619);
    }
    s += (x >>> 0).toString(16).padStart(8, "0");
  }
  return [
    s.slice(0, 8),
    s.slice(8, 12),
    "5" + s.slice(13, 16),
    ((parseInt(s.slice(16, 20), 16) & 0x3fff) | 0x8000)
      .toString(16)
      .padStart(4, "0"),
    s.slice(20, 32),
  ].join("-");
}

export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  // Upstream "channel verification" (HTTP 400 code 11128, 9router#4892):
  // www.codebuddy.ai rejects requests without the X-Conversation-* header
  // family the official IDE sends on every turn.
  // codebuddy-cn (copilot.tencent.com) is not gated, so only the intl
  // executor grows these headers.
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model);

    const sessionKey =
      (typeof body?.session_id === "string" && body.session_id) ||
      (typeof body?.prompt_cache_key === "string" && body.prompt_cache_key) ||
      (typeof body?.conversation_id === "string" && body.conversation_id) ||
      null;
    const firstUser = Array.isArray(body?.messages)
      ? body.messages.find((m) => m?.role === "user")
      : null;
    const userText =
      typeof firstUser?.content === "string"
        ? firstUser.content
        : Array.isArray(firstUser?.content)
          ? firstUser.content
              .map((b) => (b && typeof b.text === "string" ? b.text : ""))
              .join("\n")
          : "";
    const conversationKey = sessionKey || (userText ? `cbai:${userText}` : null);

    headers["X-Conversation-ID"] = conversationKey
      ? stableUuidFrom(conversationKey)
      : crypto.randomUUID();
    headers["X-Conversation-Request-ID"] = crypto.randomUUID();
    headers["X-Conversation-Message-ID"] = crypto.randomUUID();

    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    // Channel verification also rejects forwarded third-party system
    // prompts: match the official client by always using its fixed
    // system prompt and discarding client system/developer messages.
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }

  parseError(response, bodyText) {
    const fallback = super.parseError(response, bodyText);
    if (!bodyText) return fallback;
    try {
      const payload = JSON.parse(bodyText);
      const code = payload?.code ?? payload?.error?.code;
      const nested = payload?.error;
      const message = typeof nested === "object"
        ? nested?.message || payload?.msg || payload?.message
        : nested || payload?.msg || payload?.message;
      if (typeof message !== "string" && code == null) return fallback;
      const text = typeof message === "string" && message.trim()
        ? message.trim()
        : "Provider request failed";
      return {
        status: response.status,
        message: code == null ? text : `CodeBuddy ${code}: ${text}`,
      };
    } catch {
      return fallback;
    }
  }
}

export default CodeBuddyIntlExecutor;
