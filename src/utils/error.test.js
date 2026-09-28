import { describe, expect, test } from "bun:test";
import { parseUpstreamError } from "./error.js";

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
});
