import {
  ERROR_RULES,
  BACKOFF_CONFIG,
  TRANSIENT_COOLDOWN_MS,
  classifyError,
  ERROR_TIERS,
  isDeprioitized,
  isCancellationStatus,
  isNonRetryableRequestStatus,
  isQuotaExhaustionError,
} from "../config/errorConfig.js";

import { fnv1a } from "@/lib/security/payloadCapture.js";
import { extractClientSessionId } from "../utils/sessionManager.js";

export function getQuotaCooldown(backoffLevel = 0) {
  const level = Math.max(0, backoffLevel - 1);
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, level);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

export function checkFallbackError(status, errorText, backoffLevel = 0) {
  if (isQuotaExhaustionError(errorText)) {
    const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
    return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
  }

  if (isNonRetryableRequestStatus(status) || isCancellationStatus(status)) {
    return { shouldFallback: false, cooldownMs: 0, action: "final", newBackoffLevel: backoffLevel };
  }

  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";

  for (const rule of ERROR_RULES) {

    if (rule.text && lowerError && lowerError.includes(rule.text)) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }

    if (rule.status && rule.status === status) {
      if (rule.backoff) {
        const newLevel = Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel);
        return { shouldFallback: true, cooldownMs: getQuotaCooldown(newLevel), newBackoffLevel: newLevel };
      }
      return { shouldFallback: true, cooldownMs: rule.cooldownMs };
    }
  }

  return { shouldFallback: true, cooldownMs: TRANSIENT_COOLDOWN_MS };
}

export function isAccountUnavailable(unavailableUntil) {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

export function getUnavailableUntil(cooldownMs) {
  return new Date(Date.now() + cooldownMs).toISOString();
}

export function getEarliestRateLimitedUntil(accounts) {
  let earliest = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (!earliest || until < earliest) earliest = until;
  }
  if (!earliest) return null;
  return new Date(earliest).toISOString();
}

export function formatRetryAfter(rateLimitedUntil) {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

export const MODEL_LOCK_PREFIX = "modelLock_";

export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

export function getModelLockKey(model) {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

export function isModelLockActive(connection, model) {
  const key = getModelLockKey(model);
  const expiry = connection[key] || connection[MODEL_LOCK_ALL];
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

export function getEarliestModelLockUntil(connection) {
  if (!connection) return null;
  let earliest = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val).getTime();
    if (t <= now) continue;
    if (!earliest || t < earliest) earliest = t;
  }
  return earliest ? new Date(earliest).toISOString() : null;
}

export function buildModelLockUpdate(model, cooldownMs) {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

export function buildClearModelLocksUpdate(connection) {
  const cleared = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

export function filterAvailableAccounts(accounts, excludeId = null) {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

export function resetAccountState(account) {
  if (!account) return account;
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active"
  };
}

export function applyErrorState(account, status, errorText) {
  if (!account) return account;

  const backoffLevel = account.backoffLevel || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error"
  };
}

export const DEPRIORITIZE_FIELD = "deprioritizeUntil";

export function isDeprioritized(connection) {
  if (!connection) return false;
  const until = connection[DEPRIORITIZE_FIELD];
  if (!until) return false;
  return isDeprioitized(Number(until) || Date.parse(until));
}

export function buildDeprioritizeUpdate(deprioitizeUntilMs) {
  return { [DEPRIORITIZE_FIELD]: deprioitizeUntilMs || null };
}

export function buildClearDeprioritizeUpdate() {
  return { [DEPRIORITIZE_FIELD]: null };
}

export function sortWithDeprioritization(connections) {
  if (!Array.isArray(connections) || connections.length <= 1) return connections || [];
  const cmp = (a, b) => (a.priority || 999) - (b.priority || 999);
  const top = connections.filter((c) => !isDeprioritized(c)).sort(cmp);
  const bottom = connections.filter((c) => isDeprioritized(c)).sort(cmp);
  return [...top, ...bottom];
}

export function pickSticky(connections, { cacheKey, excludeIds } = {}) {
  const all = connections || [];
  if (all.length === 0) return { connection: null, affinity: "miss" };
  const excluded = excludeIds instanceof Set ? excludeIds : (excludeIds ? new Set(excludeIds) : null);
  const isOut = (c) => !!(excluded && c && excluded.has(c.id)) || isDeprioritized(c);
  const prio = (c) => (c && c.priority != null ? c.priority : 999);

  // Stable copy ordered by ascending priority (lower number = higher priority).
  // Deprioritized accounts sink last so a hashed primary never lands on cooldown.
  const ordered = all.slice().sort((a, b) => {
    const dep = Number(isDeprioritized(a)) - Number(isDeprioritized(b));
    return dep !== 0 ? dep : prio(a) - prio(b);
  });

  if (!cacheKey) {
    const firstAvail = ordered.find((c) => !isOut(c));
    return { connection: firstAvail || ordered.find((c) => !excluded?.has?.(c?.id)) || null, affinity: "miss" };
  }

  // Group into priority tiers, preserving stable order within each tier.
  const tiers = [];
  for (const c of ordered) {
    const p = (isDeprioritized(c) ? 1e9 : 0) + prio(c);
    const last = tiers[tiers.length - 1];
    if (!last || last.priority !== p) tiers.push({ priority: p, members: [c] });
    else last.members.push(c);
  }

  // Highest-priority tier with capacity wins; affinity is "hit" only when the
  // top tier's hashed primary is itself available, otherwise "rotate".
  let rotated = false;
  for (const tier of tiers) {
    const members = tier.members;
    if (members.length === 0) continue;
    if (members.every((c) => isOut(c))) {
      // Whole tier excluded → fall through to the next tier.
      rotated = true;
      continue;
    }

    const bucket = fnv1a(cacheKey) % members.length;
    const primary = members[bucket];
    if (!isOut(primary)) {
      return { connection: primary, affinity: rotated ? "rotate" : "hit" };
    }

    for (let step = 1; step < members.length; step++) {
      const cand = members[(bucket + step) % members.length];
      if (!isOut(cand)) return { connection: cand, affinity: "rotate" };
    }

    // Defensive: tier had a non-excluded member but the walk missed it.
    rotated = true;
  }

  // Every clean account is out: fall back to any non-excluded account (even on
  // cooldown) rather than hard-blocking the request.
  const lastResort = ordered.find((c) => !(excluded && c && excluded.has(c.id))) || null;
  return { connection: lastResort, affinity: "rotate" };
}

export function extractCacheKey(body) {
  if (!body || typeof body !== "object") return null;

  const contentText = (content) => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      const parts = [];
      for (const part of content) {
        if (part && typeof part.text === "string") parts.push(part.text);
        else if (part && typeof part.type === "string" && typeof part.text === "string") parts.push(part.text);
      }
      return parts.join(" ");
    }
    return "";
  };

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    for (const m of body.messages) {
      const t = contentText(m?.content);
      if (t) return t.slice(0, 256);
    }
  }

  if (Array.isArray(body.contents) && body.contents.length > 0) {
    const parts = body.contents[0]?.parts;
    if (Array.isArray(parts)) {
      const t = parts.map((p) => (p?.text ? String(p.text) : "")).join(" ");
      if (t) return t.slice(0, 256);
    }
  }

  if (typeof body.prompt === "string" && body.prompt) return body.prompt.slice(0, 256);
  if (typeof body.input === "string" && body.input) return body.input.slice(0, 256);
  return null;
}

// Resolve a stable sticky-routing key for a request.
// Priority:
//   (a) an EXPLICIT client-provided session/conversation identity (headers, or
//       body prompt_cache_key / session_id / conversation_id / metadata.user_id).
//       An explicit id means "one conversation" → pin it to one account so every
//       multi-turn request reuses that provider account's prompt cache.
//       We deliberately ignore the random/derived session fallback (generateBinaryStyleId
//       / deriveSessionId) here — it is unstable and would defeat affinity.
//   (b) otherwise fall back to the prompt-prefix text (extractCacheKey), which is
//       the best available proxy and also shares a common system prompt across clients.
// Bound to <=256 chars. Format-agnostic (OpenAI messages, Gemini contents, plain prompt/input).
/**
 * @param {{ headers?: Record<string, string>|null, body?: unknown, connectionId?: string|null, scope?: string }} [opts]
 * @returns {string|null}
 */
export function deriveCacheKey({ headers, body, connectionId, scope = "" } = {}) {
  try {
    // includeRequestId:false — x-client-request-id is PER-REQUEST, not per-conversation;
    // letting it through would make the key change every call and defeat affinity.
    const explicit = extractClientSessionId(headers, body, scope, { includeRequestId: false });
    if (explicit) return `session:${explicit}`.slice(0, 256);
  } catch {

  }
  return extractCacheKey(body);
}
