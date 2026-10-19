import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initDb } from "@/lib/db/index.js";
import {
  getSettings,
  updateSettings,
  validateFallbackStrategies,
  stripRemovedSettings,
} from "./settingsRepo.js";

beforeEach(async () => {
  await initDb();
});

afterEach(async () => {
  await updateSettings({ providerStrategies: {}, profileName: "" });
});

describe("settingsRepo retired routing strategy", () => {
  test("ignores legacy fallbackStrategy writes instead of persisting them", async () => {
    const saved = await updateSettings({ fallbackStrategy: "round-robin" });
    expect(saved).not.toHaveProperty("fallbackStrategy");

    const settings = await getSettings();
    expect(settings).not.toHaveProperty("fallbackStrategy");
  });

  test("strips legacy provider strategy keys while keeping other entry fields", async () => {
    const saved = await updateSettings({
      profileName: "Edge Router",
      providerStrategies: { openai: { fallbackStrategy: "cache-affine", proxyPoolId: "pool-1" } },
    });
    expect(saved.profileName).toBe("Edge Router");
    expect(saved.providerStrategies.openai).toEqual({ proxyPoolId: "pool-1" });
  });

  test("validateFallbackStrategies is a no-op for legacy patches", () => {
    expect(() => validateFallbackStrategies({ fallbackStrategy: "bogus-strategy" })).not.toThrow();
    expect(() => validateFallbackStrategies(null)).not.toThrow();
    expect(() => validateFallbackStrategies(undefined)).not.toThrow();
    expect(() => validateFallbackStrategies([])).not.toThrow();
  });

  test("stripRemovedSettings drops legacy keys from stored payloads", () => {
    expect(stripRemovedSettings({
      fallbackStrategy: "fill-first",
      stickyRoundRobinLimit: 3,
      providerStrategies: { openai: { fallbackStrategy: "cache-affine", stickyRoundRobinLimit: 2 } },
      profileName: "kept",
    })).toEqual({ providerStrategies: {}, profileName: "kept" });
  });
});
