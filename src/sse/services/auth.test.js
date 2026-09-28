import { describe, expect, test } from "bun:test";
import { createProviderConnection, deleteProviderConnection, getProviderConnectionById } from "@/lib/db/repos/connectionsRepo.js";
import { clearAllLocksForConnection } from "@/lib/db/repos/accountModelLocksRepo.js";
import { markAccountUnavailable } from "./auth.js";

describe("provider account availability", () => {
  test("CodeBuddy quota exhaustion disables the account-wide route", async () => {
    const connection = await createProviderConnection({
      provider: "codebuddy-cn",
      authType: "oauth",
      accessToken: "test-access-token",
      name: `quota-test-${crypto.randomUUID()}`,
    });

    try {
      const result = await markAccountUnavailable(
        connection.id,
        400,
        "You exceeded your current quota",
        "codebuddy-cn",
        "glm-5.0-turbo",
      );

      expect(result.shouldFallback).toBe(true);
      const updated = await getProviderConnectionById(connection.id);
      expect(updated?.isActive).toBe(false);
      expect(updated?.modelLock___all).toBeTruthy();
    } finally {
      await clearAllLocksForConnection(connection.id);
      await deleteProviderConnection(connection.id);
    }
  });
});
