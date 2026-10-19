import { afterEach, describe, expect, test } from "bun:test";
import {
  resolveAccountPoolConfig,
  resetAccountPoolForTests,
  tryAcquireAccountSlot,
  waitForAccountCapacity,
} from "./accountPool.js";

const config = {
  enabled: true,
  maxConcurrentPerAccount: 1,
  maxQueuePerProvider: 1,
  queueWaitTimeoutMs: 500,
};

afterEach(() => resetAccountPoolForTests());

describe("account pool leases", () => {
  test("uses a conservative global account default", () => {
    expect(resolveAccountPoolConfig({ accountPool: { enabled: true } }).maxConcurrentPerAccount).toBe(30);
  });

  test("tracks the per-account lease count", () => {
    const release = tryAcquireAccountSlot("p", "a", { ...config, maxConcurrentPerAccount: 3 });
    expect(release).not.toBeNull();
    expect(tryAcquireAccountSlot("p", "b", { ...config, maxConcurrentPerAccount: 3 })).not.toBeNull();

    release?.();
    expect(tryAcquireAccountSlot("p", "a", { ...config, maxConcurrentPerAccount: 3 })).not.toBeNull();
  });

  test("enforces the per-account limit and wakes a queued request", async () => {
    const first = tryAcquireAccountSlot("p", "a", config);
    expect(first).not.toBeNull();
    expect(tryAcquireAccountSlot("p", "a", config)).toBeNull();

    const waiting = waitForAccountCapacity("p", ["a"], config);
    first?.();
    expect(await waiting).toMatchObject({ ok: true, releasedConnectionId: "a" });

    const second = tryAcquireAccountSlot("p", "a", config);
    expect(second).not.toBeNull();
    second?.();
  });

  test("enforces the shared per-provider limit across accounts", async () => {
    const capped = { ...config, maxConcurrentPerAccount: 3, maxConcurrentPerProvider: 2 };
    const first = tryAcquireAccountSlot("p", "a", capped);
    const second = tryAcquireAccountSlot("p", "b", capped);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(tryAcquireAccountSlot("p", "c", capped)).toBeNull();

    const waiting = waitForAccountCapacity("p", ["a", "b", "c"], capped);
    first?.();
    expect(await waiting).toMatchObject({ ok: true, releasedConnectionId: "a" });
    const third = tryAcquireAccountSlot("p", "c", capped);
    expect(third).not.toBeNull();

    second?.();
    third?.();
    expect(tryAcquireAccountSlot("p", "c", capped)).not.toBeNull();
  });

  test("bounds a full queue", async () => {
    const first = tryAcquireAccountSlot("p", "a", config);
    const firstWait = waitForAccountCapacity("p", ["a"], config);
    const rejected = await waitForAccountCapacity("p", ["a"], config);
    expect(rejected).toEqual({ ok: false, reason: "queue_full" });

    first?.();
    expect(await firstWait).toMatchObject({ ok: true, releasedConnectionId: "a" });
  });
});
