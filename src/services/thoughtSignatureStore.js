const MAX_ENTRIES = 4096;
const TTL_MS = 30 * 60 * 1000;

const signatures = new Map();

function keyFor(callId, sessionId, model) {
  return `${String(sessionId)}\u0000${String(model)}\u0000${String(callId)}`;
}

function isUsable(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 * 1024;
}

function prune(now = Date.now()) {
  for (const [key, entry] of signatures) {
    if (entry.expiresAt <= now) signatures.delete(key);
  }
  while (signatures.size > MAX_ENTRIES) {
    const oldest = signatures.keys().next().value;
    if (oldest === undefined) break;
    signatures.delete(oldest);
  }
}

export function rememberGeminiThoughtSignature(callId, sessionId, model, signature) {
  if (!isUsable(callId) || !isUsable(sessionId) || !isUsable(model) || !isUsable(signature)) return;
  const key = keyFor(callId, sessionId, model);
  signatures.delete(key);
  signatures.set(key, { signature, expiresAt: Date.now() + TTL_MS });
  prune();
}

export function getGeminiThoughtSignatureSync(callId, sessionId, model) {
  if (!isUsable(callId) || !isUsable(sessionId) || !isUsable(model)) return null;
  const key = keyFor(callId, sessionId, model);
  const entry = signatures.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    signatures.delete(key);
    return null;
  }
  signatures.delete(key);
  signatures.set(key, entry);
  return entry.signature;
}

export function clearGeminiThoughtSignatures() {
  signatures.clear();
}
