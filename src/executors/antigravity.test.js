import { describe, expect, it } from "bun:test";
import { AntigravityExecutor } from "./antigravity.js";

describe("Antigravity executor", () => {
  it("omits requestType on the normal agent chat envelope", () => {
    const executor = new AntigravityExecutor();
    const body = {
      model: "claude-sonnet-4-6",
      requestType: "agent",
      reasoning_effort: "high",
      request: {
        sessionId: "123",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        generationConfig: { maxOutputTokens: 1024 },
      },
    };

    const transformed = executor.transformRequest("claude-sonnet-4-6", body, true, {
      projectId: "project-1",
      connectionId: "connection-1",
    });

    expect(transformed.requestType).toBeUndefined();
    expect(transformed.reasoning_effort).toBeUndefined();
    expect(transformed.request.sessionId).toBe("123");
  });
});
