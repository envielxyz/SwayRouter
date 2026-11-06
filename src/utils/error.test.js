import { describe, expect, test } from "bun:test";
import { parseUpstreamError, parseResetTimestamp, extractRateLimitReset } from "./error.js";
describe("parseUpstreamError", () => {
  test("preserves CodeBuddy CN quota details from a 400 response", async () => {
    const response = new Response(JSON.stringify({
      code: "QUOTA_EXCEEDED",
      message: "You exceeded your current quota",
    }), { status: 400 });

    const parsed = await parseUpstreamError(response, {
      provider: "codebuddy-cn",
      parseError(upstreamResponse, bodyText) {
        return { status: upstreamResponse.status, message: bodyText };
      },
    });

    expect(parsed.statusCode).toBe(400);
    expect(parsed.message).toContain("quota");
  });

  test("extracts resetsAtMs from Retry-After header in seconds", async () => {
    const now = Date.now();
    const response = new Response("Too Many Requests", {
      status: 429,
      headers: { "Retry-After": "2" },
    });
    const parsed = await parseUpstreamError(response);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(now + 1900);
    expect(parsed.resetsAtMs).toBeLessThanOrEqual(now + 2500);
  });

  test("extracts resetsAtMs from x-ratelimit-reset header", async () => {
    const now = Date.now();
    const response = new Response("Rate limit", {
      status: 429,
      headers: { "x-ratelimit-reset-requests": "1.5s" },
    });
    const parsed = await parseUpstreamError(response);
    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(now + 1400);
  });

  test("extracts resetsAtMs from JSON body error.retry_after", async () => {
    const now = Date.now();
    const response = new Response(JSON.stringify({
      error: { message: "rate limited", retry_after: 5 },
    }), { status: 429, headers: { "content-type": "application/json" } });
    const parsed = await parseUpstreamError(response);
    expect(parsed.resetsAtMs).toBeGreaterThanOrEqual(now + 4900);
  });
});

describe("parseResetTimestamp", () => {
  test("parses delta seconds", () => {
    const now = Date.now();
    const ts = parseResetTimestamp("3");
    expect(ts).toBeGreaterThanOrEqual(now + 2900);
  });

  test("parses string with s suffix", () => {
    const now = Date.now();
    const ts = parseResetTimestamp("1.5s");
    expect(ts).toBeGreaterThanOrEqual(now + 1400);
  });

  test("parses string with ms suffix", () => {
    const now = Date.now();
    const ts = parseResetTimestamp("500ms");
    expect(ts).toBeGreaterThanOrEqual(now + 400);
  });

  test("returns null for invalid strings", () => {
    expect(parseResetTimestamp("")).toBeNull();
    expect(parseResetTimestamp("abc")).toBeNull();
    expect(parseResetTimestamp("-5")).toBeNull();
  });
});
