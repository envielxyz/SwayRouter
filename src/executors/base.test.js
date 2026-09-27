import { afterEach, describe, expect, test, mock } from "bun:test";

const fetchCalls = [];
const nativeFetch = globalThis.fetch.bind(globalThis);
mock.module("@/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => {
    fetchCalls.push(args);
    return globalThis.__baseExecutorFetch?.(...args) ?? nativeFetch(...args);
  },
}));

afterEach(() => {
  delete globalThis.__baseExecutorFetch;
});

const { BaseExecutor, waitForRetry } = await import("./base.js");
const { isUpstreamTimeoutError } = await import("../utils/upstreamTimeout.js");

function response(status) {
  return new Response(JSON.stringify({ error: { message: `status ${status}` } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("BaseExecutor retry and cancellation", () => {
  test("waitForRetry stops immediately when the request is aborted", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const pending = waitForRetry(1000, controller.signal);
    setTimeout(() => controller.abort(new Error("cancelled")), 5);
    await expect(pending).rejects.toThrow("cancelled");
    expect(Date.now() - started).toBeLessThan(500);
  });

  test("retries transient 500 responses using the bounded retry policy", async () => {
    fetchCalls.length = 0;
    let calls = 0;
    globalThis.__baseExecutorFetch = async () => {
      calls += 1;
      return calls === 1 ? response(500) : response(200);
    };
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 500: { attempts: 1, delayMs: 1 } },
    });

    const result = await executor.execute({
      model: "test-model",
      body: { model: "test-model" },
      stream: false,
      credentials: {},
    });

    expect(result.response.status).toBe(200);
    expect(fetchCalls).toHaveLength(2);
    delete globalThis.__baseExecutorFetch;
  });

  test("cancels discarded response bodies before retrying", async () => {
    let calls = 0;
    let cancelled = 0;
    globalThis.__baseExecutorFetch = async () => {
      calls += 1;
      if (calls === 1) {
        return {
          status: 500,
          headers: new Headers({ "content-type": "application/json" }),
          body: { cancel: async () => { cancelled += 1; } },
        };
      }
      return response(200);
    };

    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 500: { attempts: 1, delayMs: 1 } },
    });
    const result = await executor.execute({
      model: "test-model",
      body: { model: "test-model" },
      stream: false,
      credentials: {},
    });

    expect(result.response.status).toBe(200);
    expect(cancelled).toBe(1);
    delete globalThis.__baseExecutorFetch;
  });

  test("honors a total attempt budget across provider retries", async () => {
    fetchCalls.length = 0;
    let calls = 0;
    globalThis.__baseExecutorFetch = async () => {
      calls += 1;
      return response(500);
    };
    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 500: { attempts: 10, delayMs: 1 } },
    });

    const result = await executor.execute({
      model: "test-model",
      body: { model: "test-model" },
      stream: false,
      credentials: {},
      maxTotalAttempts: 2,
    });

    expect(result.response.status).toBe(500);
    expect(calls).toBe(2);
    delete globalThis.__baseExecutorFetch;
  });

  test("aborts a stalled upstream attempt at the configured timeout", async () => {
    globalThis.__baseExecutorFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
      if (signal.aborted) {
        reject(signal.reason);
        return;
      }
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });

    const executor = new BaseExecutor("test", {
      baseUrl: "https://provider.test/chat",
      retry: { 502: { attempts: 0, delayMs: 0 } },
    });

    let error;
    try {
      await executor.execute({
        model: "test-model",
        body: { model: "test-model" },
        stream: false,
        credentials: {},
        attemptTimeoutMs: 10,
      });
    } catch (caught) {
      error = caught;
    }

    expect(isUpstreamTimeoutError(error)).toBe(true);
    expect(error.kind).toBe("attempt");
    delete globalThis.__baseExecutorFetch;
  });
});
