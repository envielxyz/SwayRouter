import { afterEach, describe, expect, it } from "bun:test";
import {
  clearGeminiThoughtSignatures,
  getGeminiThoughtSignatureSync,
  rememberGeminiThoughtSignature,
} from "./thoughtSignatureStore.js";

afterEach(() => {
  clearGeminiThoughtSignatures();
});

describe("Antigravity thought signature store", () => {
  it("scopes signatures by call, session, and model", () => {
    rememberGeminiThoughtSignature("call-1", "session-a", "model-a", "sig-a");

    expect(getGeminiThoughtSignatureSync("call-1", "session-a", "model-a")).toBe("sig-a");
    expect(getGeminiThoughtSignatureSync("call-1", "session-b", "model-a")).toBeNull();
    expect(getGeminiThoughtSignatureSync("call-1", "session-a", "model-b")).toBeNull();
  });

  it("rejects empty or oversized values", () => {
    rememberGeminiThoughtSignature("", "session-a", "model-a", "sig-a");
    rememberGeminiThoughtSignature("call-1", "session-a", "model-a", "");

    expect(getGeminiThoughtSignatureSync("call-1", "session-a", "model-a")).toBeNull();
  });
});
