import { describe, expect, test } from "bun:test";
import { getCapabilitiesForModel } from "./capabilities.js";

// Regression: muse-spark supports vision upstream (probed 2026-11-01:
// 16x16 red PNG answered, not rejected). Without this pattern the router
// silently strips images via stripUnsupportedModalities.
describe("muse-spark capabilities", () => {
  test("muse-spark variants resolve vision + reasoning", () => {
    for (const m of [
      "muse-spark-1.3-contributor",
      "muse-spark-1.3",
      "muse-spark-1.2-contributor",
      "muse-spark-1.1",
    ]) {
      const caps = getCapabilitiesForModel("meta", m);
      expect(caps.vision, m).toBe(true);
      expect(caps.reasoning, m).toBe(true);
    }
  });

  test("non-spark muse models keep default caps", () => {
    for (const m of ["muse-wonder-1.0", "muse-voice-transcribe-1.0", "muse-image-1.0"]) {
      const caps = getCapabilitiesForModel("meta", m);
      expect(caps.vision, m).toBe(false);
      expect(caps.reasoning, m).toBe(false);
    }
  });
});
