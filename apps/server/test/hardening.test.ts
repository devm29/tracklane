import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { type TestStack, startStack } from "./stack.js";

describe("login rate limiting", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startStack({ loginRateLimit: { max: 3, windowSeconds: 60 }, demoWorkspaceSlug: null });
  });

  afterAll(async () => {
    await stack.close();
  });

  it("answers 429 with Retry-After once an account sees too many attempts", async () => {
    const attempt = () => request(stack.server.http).post("/api/auth/login").send({ email: "maya@lumen.dev", password: "guess" });
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) statuses.push((await attempt()).status);
    expect(statuses).toEqual([401, 401, 401, 429]);
    const blocked = await attempt();
    expect(blocked.body.error.code).toBe("rate_limited");
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("hides demo accounts when demo mode is off", async () => {
    const response = await request(stack.server.http).get("/api/auth/demo-accounts");
    expect(response.body.accounts).toEqual([]);
  });
});

describe("login rate limiting without a trusted proxy", () => {
  let stack: TestStack;

  beforeAll(async () => {
    stack = await startStack({ loginRateLimit: { max: 3, windowSeconds: 60 } });
  });

  afterAll(async () => {
    await stack.close();
  });

  it("ignores X-Forwarded-For, so a client can't rotate its way past the per-IP limit", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 4; index += 1) {
      const response = await request(stack.server.http)
        .post("/api/auth/login")
        .set("X-Forwarded-For", `203.0.113.${index + 1}`)
        .send({ email: `nobody-${index}@lumen.dev`, password: "guess" });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});

describe("config", () => {
  const base = { JWT_SECRET: "a-real-secret-with-more-than-32-characters-in-it" };

  it("keeps demo mode off unless it is asked for", () => {
    expect(loadConfig(base).demoWorkspaceSlug).toBeNull();
    expect(loadConfig({ ...base, DEMO_MODE: "true" }).demoWorkspaceSlug).toBe("lumen");
  });

  it("trusts no proxy hops unless TRUST_PROXY_HOPS is set", () => {
    expect(loadConfig(base).trustProxyHops).toBe(0);
    expect(loadConfig({ ...base, TRUST_PROXY_HOPS: "1" }).trustProxyHops).toBe(1);
    expect(() => loadConfig({ ...base, TRUST_PROXY_HOPS: "-1" })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it("refuses example secrets in production", () => {
    const secret = "change-me-to-a-long-random-string-of-48-chars";
    expect(() => loadConfig({ NODE_ENV: "production", JWT_SECRET: secret })).toThrow(/JWT_SECRET/);
    expect(() => loadConfig({ NODE_ENV: "development", JWT_SECRET: secret })).not.toThrow();
  });
});
