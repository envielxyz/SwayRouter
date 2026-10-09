import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { initDb } from "@/lib/db/index.js";
import {
  FALLBACK_STRATEGIES,
  getSettings,
  updateSettings,
  validateFallbackStrategies,
} from "./settingsRepo.js";

beforeEach(async () => {
  await initDb();
});

afterEach(async () => {
  await updateSettings({ fallbackStrategy: "fill-first", providerStrategies: {}, profileName: "" });
});

describe("settingsRepo fallbackStrategy write validation", () => {
  test("accepts every allowed fallbackStrategy value", async () => {
    for (const strategy of FALLBACK_STRATEGIES) {
      const saved = await updateSettings({ fallbackStrategy: strategy });
      expect(saved.fallbackStrategy).toBe(strategy);
    }
  });

  test("rejects an unknown top-level fallbackStrategy without persisting it", async () => {
    await updateSettings({ fallbackStrategy: "round-robin" });

    await expect(updateSettings({ fallbackStrategy: "bogus-strategy" })).rejects.toMatchObject({
      code: "INVALID_FALLBACK_STRATEGY",
    });

    const settings = await getSettings();
    expect(settings.fallbackStrategy).toBe("round-robin");
  });

  test("rejects an unknown nested providerStrategies.<provider>.fallbackStrategy", async () => {
    await expect(
      updateSettings({ providerStrategies: { openai: { fallbackStrategy: "bogus-strategy" } } }),
    ).rejects.toMatchObject({ code: "INVALID_FALLBACK_STRATEGY" });
  });

  test("accepts a valid nested provider strategy and unrelated fields", async () => {
    const saved = await updateSettings({
      profileName: "Edge Router",
      providerStrategies: { openai: { fallbackStrategy: "cache-affine" } },
    });
    expect(saved.profileName).toBe("Edge Router");
    expect(saved.providerStrategies.openai.fallbackStrategy).toBe("cache-affine");
  });

  test("only validates fields present in the patch (no throw when absent)", async () => {
    const saved = await updateSettings({ currency: "IDR" });
    expect(saved.currency).toBe("IDR");
  });

  test("validateFallbackStrategies ignores a non-object patch", () => {
    expect(() => validateFallbackStrategies(null)).not.toThrow();
    expect(() => validateFallbackStrategies(undefined)).not.toThrow();
    expect(() => validateFallbackStrategies([])).not.toThrow();
  });
});
