import { afterEach, describe, expect, it } from "bun:test";
import { geminiToOpenAIResponse } from "./gemini-to-openai.js";
import {
  clearGeminiThoughtSignatures,
  getGeminiThoughtSignatureSync,
} from "../../services/thoughtSignatureStore.js";

afterEach(() => {
  clearGeminiThoughtSignatures();
});

describe("Gemini response signature capture", () => {
  it("stores an Antigravity tool signature under the requested model", () => {
    const state = {
      provider: "antigravity",
      sessionId: "session-a",
      model: null,
      signatureModel: "claude-sonnet-4-6",
    };

    geminiToOpenAIResponse({
      response: {
        modelVersion: "claude-sonnet-4-6-preview",
        candidates: [{
          content: {
            parts: [{
              functionCall: { id: "call-1", name: "run", args: {} },
              thoughtSignature: "signature-1",
            }],
          },
        }],
      },
    }, state);

    expect(getGeminiThoughtSignatureSync("call-1", "session-a", "claude-sonnet-4-6"))
      .toBe("signature-1");
    expect(getGeminiThoughtSignatureSync("call-1", "session-a", "claude-sonnet-4-6-preview"))
      .toBeNull();
  });
});
