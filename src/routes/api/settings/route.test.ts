import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __test__, PATCH } from "./route.js";
import { cookieStoreAls, createCookieStore } from "@/next/server";
import { initDb } from "@/lib/db/index.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";

beforeEach(async () => {
  await initDb();
});

afterEach(async () => {
  await updateSettings({ providerStrategies: {}, profileName: "" });
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

describe("PATCH /api/settings retired routing strategy", () => {
  test("ignores legacy strategy fields instead of persisting them", async () => {
    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fallbackStrategy: "cache-affine", stickyRoundRobinLimit: 3 }),
    })));
    expect(response.status).toBe(200);
    expect(await getSettings()).not.toHaveProperty("fallbackStrategy");
    expect(await getSettings()).not.toHaveProperty("stickyRoundRobinLimit");
  });

  test("strips legacy nested provider strategy keys", async () => {
    const response = await cookieStoreAls.run({ cookies: createCookieStore(), headers: new Headers() }, () => PATCH(new Request("http://localhost/api/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerStrategies: { openai: { fallbackStrategy: "bogus-strategy" } } }),
    })));
    expect(response.status).toBe(200);
    expect((await getSettings()).providerStrategies).toEqual({});
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
