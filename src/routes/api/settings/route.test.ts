import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __test__, PATCH } from "./route.js";
import { cookieStoreAls, createCookieStore } from "@/next/server";
import { initDb } from "@/lib/db/index.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";

beforeEach(async () => {
  await initDb();
});

afterEach(async () => {
  await updateSettings({ fallbackStrategy: "fill-first", providerStrategies: {}, profileName: "" });
});

describe("settings response serialization", () => {
  test("omits server-owned database paths and secrets", () => {
    const result = __test__.sanitizeSettingsForResponse({
      requireLogin: true,
      dbPath: "/srv/swayrouter/db/data.sqlite",
      password: "$2b$10$stored-hash",
      accentColor: "#ffffff",
      outboundProxyEnabled: true,
    });

    expect(result).toEqual({
      requireLogin: true,
    });
    expect(result).not.toHaveProperty("dbPath");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("accentColor");
  });

  test("does not preserve a client-supplied dbPath", () => {
    const result = __test__.sanitizeSettingsForResponse({
      dbPath: "C:\\Users\\operator\\database.sqlite",
      requireApiKey: false,
    });

    expect(result).toEqual({
      requireApiKey: false,
    });
  });
});

describe("PATCH /api/settings fallbackStrategy validation", () => {
  test("accepts a valid strategy and persists it", async () => {
    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackStrategy: "cache-affine" }),
    })));
    expect(response.status).toBe(200);
    expect((await getSettings()).fallbackStrategy).toBe("cache-affine");
  });

  test("rejects an unknown strategy with 400 and does not persist it", async () => {
    await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackStrategy: "round-robin" }),
    })));

    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackStrategy: "bogus-strategy" }),
    })));
    expect(response.status).toBe(400);
    const payload = await response.json();
    const message = payload && typeof payload === "object" && "error" in payload ? payload.error : "";
    expect(String(message)).toContain("bogus-strategy");

    expect((await getSettings()).fallbackStrategy).toBe("round-robin");
  });

  test("rejects an unknown nested provider strategy with 400", async () => {
    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerStrategies: { openai: { fallbackStrategy: "bogus-strategy" } } }),
    })));
    expect(response.status).toBe(400);
  });

  test("still saves an unrelated settings field", async () => {
    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ profileName: "Router Edge" }),
    })));
    expect(response.status).toBe(200);
    expect((await getSettings()).profileName).toBe("Router Edge");
  });
});
