import { describe, expect, test } from "bun:test";
import {
  validateSpeechBody,
  validateAudioFile,
  redactAudioError,
  MAX_SPEECH_INPUT_LENGTH,
  MAX_AUDIO_BYTES,
} from "./audioValidation.js";

describe("audioValidation", () => {
  describe("validateSpeechBody", () => {
    test("rejects non-object or null body", () => {
      expect(validateSpeechBody(null).error).toBeDefined();
      expect(validateSpeechBody(undefined).error).toBeDefined();
      expect(validateSpeechBody("string").error).toBeDefined();
    });

    test("rejects missing model", () => {
      const res = validateSpeechBody({ input: "hello" });
      expect(res.error).toBe("model is required");
    });

    test("rejects missing or empty input", () => {
      const res1 = validateSpeechBody({ model: "tts-1" });
      expect(res1.error).toBe("input text is required");

      const res2 = validateSpeechBody({ model: "tts-1", input: "   " });
      expect(res2.error).toBe("input text is required");
    });

    test("rejects input exceeding max length", () => {
      const longInput = "a".repeat(MAX_SPEECH_INPUT_LENGTH + 1);
      const res = validateSpeechBody({ model: "tts-1", input: longInput });
      expect(res.error).toContain("input exceeds maximum length");
    });

    test("validates speed range between 0.25 and 4.0", () => {
      expect(validateSpeechBody({ model: "tts-1", input: "test", speed: 0.1 }).error).toBeDefined();
      expect(validateSpeechBody({ model: "tts-1", input: "test", speed: 5.0 }).error).toBeDefined();
      expect(validateSpeechBody({ model: "tts-1", input: "test", speed: 1.5 }).error).toBeUndefined();
    });

    test("validates and defaults response_format and voice", () => {
      const res = validateSpeechBody({ model: "tts-1", input: "test" });
      expect(res.error).toBeUndefined();
      expect(res.value?.voice).toBe("alloy");
      expect(res.value?.response_format).toBe("mp3");
      expect(res.value?.speed).toBe(1.0);
    });

    test("rejects unsupported response_format", () => {
      const res = validateSpeechBody({ model: "tts-1", input: "test", response_format: "unsupported" });
      expect(res.error).toContain("Unsupported response_format");
    });
  });

  describe("validateAudioFile", () => {
    test("rejects empty or missing file", () => {
      expect(validateAudioFile(null).error).toBeDefined();
      expect(validateAudioFile({ size: 0 }).error).toBe("file cannot be empty");
    });

    test("rejects file exceeding size limit", () => {
      const res = validateAudioFile({ size: MAX_AUDIO_BYTES + 10, name: "test.mp3" });
      expect(res.error).toContain("exceeds maximum limit");
    });

    test("accepts valid audio files by extension and mime", () => {
      expect(validateAudioFile({ size: 1024, name: "recording.mp3", type: "audio/mpeg" }).valid).toBe(true);
      expect(validateAudioFile({ size: 1024, name: "sample.wav", type: "audio/wav" }).valid).toBe(true);
      expect(validateAudioFile({ size: 1024, name: "voice.ogg", type: "audio/ogg" }).valid).toBe(true);
      expect(validateAudioFile({ size: 1024, name: "speech.m4a", type: "audio/m4a" }).valid).toBe(true);
    });

    test("rejects unsupported file formats", () => {
      const res = validateAudioFile({ size: 1024, name: "document.pdf", type: "application/pdf" });
      expect(res.error).toContain("Unsupported audio format");
    });
  });

  describe("redactAudioError", () => {
    test("redacts sensitive auth tokens in error messages", () => {
      const err = new Error("Request failed with Authorization: Bearer secret_token_12345");
      expect(redactAudioError(err)).toBe("Request failed with Authorization=[redacted]");
    });
  });
});
