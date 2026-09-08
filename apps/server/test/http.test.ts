import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type TestStack, startStack } from "./stack.js";

let stack: TestStack;

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack.close();
});

describe("http api", () => {
  it("reports health", async () => {
    const response = await request(stack.server.http).get("/healthz");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", checks: { mongo: "up" } });
  });

  it("rejects bad credentials with a helpful message", async () => {
    const response = await request(stack.server.http)
      .post("/api/auth/login")
      .send({ email: "maya@lumen.dev", password: "wrong" });
    expect(response.status).toBe(401);
    expect(response.body.error.message).toBe("Email or password is incorrect");
  });

  it("validates request bodies", async () => {
    const response = await request(stack.server.http).post("/api/auth/login").send({ email: "nope" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("bad_request");
  });

  it("requires a token for sync endpoints", async () => {
    expect((await request(stack.server.http).get("/api/sync/bootstrap")).status).toBe(401);
  });

  it("paginates issues with an opaque cursor", async () => {
    const { token } = await stack.login("jonas@lumen.dev");
    const auth = { authorization: `Bearer ${token}` };
    const first = await request(stack.server.http).get("/api/issues?limit=20").set(auth);
    expect(first.status).toBe(200);
    expect(first.body.issues).toHaveLength(20);
    const second = await request(stack.server.http).get(`/api/issues?limit=20&cursor=${first.body.nextCursor}`).set(auth);
    expect(second.body.issues).toHaveLength(10);
    expect(second.body.nextCursor).toBeNull();
    const ids = new Set([...first.body.issues, ...second.body.issues].map((issue: { id: string }) => issue.id));
    expect(ids.size).toBe(30);
  });

  it("lists only the configured demo workspace's accounts", async () => {
    const { models } = stack.server.services;
    const workspaceId = crypto.randomUUID();
    await models.Workspace.create({ _id: workspaceId, name: "Private", slug: "private" });
    await models.User.create({
      _id: crypto.randomUUID(),
      workspaceId,
      name: "Hidden",
      email: "hidden@private.dev",
      role: "admin",
      avatarHue: 1,
      passwordHash: "scrypt$x$y",
    });
    const response = await request(stack.server.http).get("/api/auth/demo-accounts");
    expect(response.body.accounts).toHaveLength(6);
    expect(response.body.accounts.map((account: { email: string }) => account.email)).not.toContain("hidden@private.dev");
  });

  it("compresses large responses", async () => {
    const { token } = await stack.login("maya@lumen.dev");
    const response = await request(stack.server.http)
      .get("/api/sync/bootstrap")
      .set({ authorization: `Bearer ${token}`, "accept-encoding": "gzip" });
    expect(response.status).toBe(200);
    expect(response.headers["content-encoding"]).toBe("gzip");
  });
});
