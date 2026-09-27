import { describe, expect, test } from "bun:test";
import {
  UpstreamTimeoutError,
  executeWithAttemptDeadline,
  isUpstreamTimeoutError,
} from "./upstreamTimeout.js";

function waitForSignal(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

describe("upstream timeout guards", () => {
  test("aborts a stalled attempt and reports an upstream timeout", async () => {
    let aborted = false;

    const promise = executeWithAttemptDeadline(
      async (signal) => {
        try {
          await waitForSignal(signal);
        } catch (error) {
          aborted = signal.aborted;
          throw error;
        }
      },
      { timeoutMs: 10 },
    );

    await expect(promise).rejects.toBeInstanceOf(UpstreamTimeoutError);
    expect(aborted).toBe(true);
  });

  test("caps an attempt at the remaining request deadline", async () => {
    const deadlineAt = Date.now() + 10;
    const promise = executeWithAttemptDeadline(
      async (signal) => waitForSignal(signal),
      { timeoutMs: 1000, deadlineAt },
    );

    await expect(promise).rejects.toMatchObject({
      name: "UpstreamTimeoutError",
      kind: "deadline",
    });
  });

  test("preserves caller cancellation as an abort instead of a timeout", async () => {
    const caller = new AbortController();
    const promise = executeWithAttemptDeadline(
      async (signal) => waitForSignal(signal),
      { signal: caller.signal, timeoutMs: 1000 },
    );

    caller.abort(new DOMException("cancelled", "AbortError"));

    let error;
    try {
      await promise;
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ name: "AbortError" });
    expect(isUpstreamTimeoutError(error)).toBe(false);
  });
});
