const DEFAULT_ATTEMPT_TIMEOUT_MS = 15_000;

export class UpstreamTimeoutError extends Error {
  constructor(message, { kind = "attempt", timeoutMs = 0 } = {}) {
    super(message);
    this.name = "UpstreamTimeoutError";
    this.code = "UPSTREAM_TIMEOUT";
    this.kind = kind;
    this.timeoutMs = timeoutMs;
  }
}
export function isUpstreamTimeoutError(error) {
  return error?.name === "UpstreamTimeoutError" || error?.code === "UPSTREAM_TIMEOUT";
}

function resolveTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_ATTEMPT_TIMEOUT_MS;
}

export function createUpstreamAttemptSignal({ signal = null, timeoutMs, deadlineAt = null } = {}) {
  const configuredTimeoutMs = resolveTimeoutMs(timeoutMs);
  const remainingMs = deadlineAt == null ? Infinity : Number(deadlineAt) - Date.now();

  if (remainingMs <= 0) {
    throw new UpstreamTimeoutError("Upstream request deadline exceeded", {
      kind: "deadline",
      timeoutMs: 0,
    });
  }

  const budgetMs = Math.max(1, Math.min(configuredTimeoutMs, remainingMs));
  const kind = Number.isFinite(remainingMs) && remainingMs <= configuredTimeoutMs
    ? "deadline"
    : "attempt";
  const timeoutError = new UpstreamTimeoutError(
    kind === "deadline"
      ? "Upstream request deadline exceeded"
      : `Upstream attempt timed out after ${Math.ceil(budgetMs)}ms`,
    { kind, timeoutMs: budgetMs },
  );
  const timeoutController = new AbortController();
  const mergedSignal = signal
    ? AbortSignal.any([signal, timeoutController.signal])
    : timeoutController.signal;
  const timer = setTimeout(() => timeoutController.abort(timeoutError), budgetMs);

  return {
    signal: mergedSignal,
    timeoutError,
    timeoutMs: budgetMs,
    wasTimeout: () => timeoutController.signal.aborted && !signal?.aborted,
    cleanup: () => clearTimeout(timer),
  };
}

export async function executeWithAttemptDeadline(execute, options = {}) {
  const attempt = createUpstreamAttemptSignal(options);
  try {
    return await execute(attempt.signal, attempt.timeoutMs);
  } catch (error) {
    if (attempt.wasTimeout()) throw attempt.timeoutError;
    throw error;
  } finally {
    attempt.cleanup();
  }
}
