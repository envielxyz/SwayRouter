import { describe, expect, test } from "bun:test";
import { hasValidCliToken, isLocalRequest } from "./dashboardGuard.js";

describe("CLI token validation", () => {
  test("does not trust an arbitrary non-empty CLI header", async () => {
    const request = new Request("http://localhost/api/settings/database", {
      headers: { "x-swayrouter-cli-token": "not-a-machine-token" },
    });
    expect(await hasValidCliToken(request)).toBe(false);
  });
});

describe("local dashboard request detection", () => {
  test("accepts loopback host and origin through a Docker bridge", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: {
        host: "localhost:14045",
        origin: "http://localhost:14045",
        "x-swayrouter-real-ip": "172.18.0.1",
      },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

  test("does not treat a proxied request as local", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: {
        host: "localhost:14045",
        origin: "http://localhost:14045",
        "x-swayrouter-via-proxy": "1",
        "x-swayrouter-real-ip": "127.0.0.1",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });
});
