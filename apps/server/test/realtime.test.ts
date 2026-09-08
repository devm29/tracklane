import type { PresenceUpdate, SyncDelta } from "@tracklane/domain";
import { MemoryStore, SyncClient } from "@tracklane/sync-core";
import { SocketIoTransport } from "@tracklane/sync-core/socket-io";
import { SignJWT } from "jose";
import { io } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stableId } from "../src/seed/seed.js";
import { TEST_JWT_SECRET, type TestStack, startStack } from "./stack.js";

let stack: TestStack;
const engIssue = stableId("issue:ENG-2");

beforeAll(async () => {
  stack = await startStack({ accessRefreshMs: 100 });
});

afterAll(async () => {
  await stack.close();
});

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function replica(email: string): Promise<SyncClient> {
  const { token } = await stack.login(email);
  const user = (await stack.server.services.users.findCredentials(email))?.user;
  if (!user) throw new Error(`missing ${email}`);
  const client = new SyncClient({
    actor: { userId: user.id, workspaceId: user.workspaceId, role: user.role },
    store: new MemoryStore(),
    transport: new SocketIoTransport({ url: stack.url, getToken: () => token }),
  });
  await client.start();
  await waitFor(() => client.getStatus().connection === "live");
  return client;
}

describe("realtime sync", () => {
  it("rejects sockets without a valid token", async () => {
    const socket = io(stack.url, { auth: { token: "nope" }, transports: ["websocket"], reconnection: false });
    const error = await new Promise<Error>((resolve) => socket.once("connect_error", resolve));
    expect(error.message).toBe("unauthorized");
    socket.disconnect();
  });

  it("fans deltas out only to sockets in the issue's team", async () => {
    const jonas = await stack.login("jonas@lumen.dev");
    const priya = await stack.login("priya@lumen.dev");
    const diego = await stack.login("diego@lumen.dev");
    const priyaSocket = await stack.socket(priya.token);
    const diegoSocket = await stack.socket(diego.token);
    const jonasSocket = await stack.socket(jonas.token);
    const received: SyncDelta[] = [];
    const leaked: SyncDelta[] = [];
    priyaSocket.on("sync:delta", (delta: SyncDelta) => received.push(delta));
    diegoSocket.on("sync:delta", (delta: SyncDelta) => leaked.push(delta));

    const clientTxId = crypto.randomUUID();
    const ack = await jonasSocket.emitWithAck("sync:push", {
      txs: [{ clientTxId, createdAt: new Date().toISOString(), mutation: { kind: "issue.update", id: engIssue, patch: { priority: 1 } } }],
    });
    expect(ack.ok).toBe(true);
    await waitFor(() => received.length === 1);
    expect(received[0]).toMatchObject({ clientTxId, modelId: engIssue, data: { priority: 1 } });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(leaked).toEqual([]);
  });

  it("rejects malformed transactions individually instead of failing the batch", async () => {
    const { token } = await stack.login("jonas@lumen.dev");
    const socket = await stack.socket(token);
    const good = crypto.randomUUID();
    const bad = crypto.randomUUID();
    const ack = await socket.emitWithAck("sync:push", {
      txs: [
        { clientTxId: bad, createdAt: new Date().toISOString(), mutation: { kind: "issue.update", id: engIssue, patch: {} } },
        { clientTxId: good, createdAt: new Date().toISOString(), mutation: { kind: "issue.update", id: engIssue, patch: { priority: 3 } } },
      ],
    });
    expect(ack.ok).toBe(true);
    const statuses = Object.fromEntries(ack.data.results.map((result: { clientTxId: string; status: string }) => [result.clientTxId, result.status]));
    expect(statuses).toEqual({ [bad]: "rejected", [good]: "accepted" });
  });

  it("broadcasts who is viewing an issue", async () => {
    const maya = await stack.login("maya@lumen.dev");
    const jonas = await stack.login("jonas@lumen.dev");
    const watcher = await stack.socket(jonas.token);
    const viewer = await stack.socket(maya.token);
    const updates: PresenceUpdate[] = [];
    watcher.on("presence:update", (update: PresenceUpdate) => updates.push(update));

    viewer.emit("presence:view", { issueIds: [engIssue] });
    await waitFor(() => updates.some((update) => update.viewerIds.includes(maya.userId)));
    viewer.disconnect();
    await waitFor(() => updates.at(-1)?.viewerIds.length === 0);
  });

  it("keeps two full replicas consistent through the real server", async () => {
    const jonas = await replica("jonas@lumen.dev");
    const elena = await replica("elena@lumen.dev");
    const issueId = jonas.createIssue({
      teamId: stableId("team:ENG"),
      title: "Created through the sync engine",
      description: "",
      status: "todo",
      priority: 2,
      assigneeId: null,
      projectId: null,
      labelIds: [],
      sortOrder: -1,
    });
    expect(jonas.pool.get("issue", issueId)?.number).toBe(0);

    await waitFor(() => elena.pool.get("issue", issueId) !== undefined);
    elena.updateIssue(issueId, { status: "in_progress" });
    jonas.addComment({ issueId, body: "Picking this up" });

    await waitFor(
      () =>
        jonas.getStatus().pending.length === 0 &&
        elena.getStatus().pending.length === 0 &&
        jonas.getStatus().lastSyncId === elena.getStatus().lastSyncId &&
        elena.pool.all("comment").some((comment) => comment.issueId === issueId),
    );
    expect(jonas.pool.get("issue", issueId)).toEqual(elena.pool.get("issue", issueId));
    expect(jonas.pool.get("issue", issueId)?.status).toBe("in_progress");
    expect(jonas.pool.get("issue", issueId)?.number).toBeGreaterThan(0);

    await jonas.stop();
    await elena.stop();
  });

  it("catches up after being offline", async () => {
    const jonas = await replica("jonas@lumen.dev");
    const elena = await replica("elena@lumen.dev");
    elena.setNetworkEnabled(false);
    jonas.updateIssue(engIssue, { title: "Edited while Elena was offline" });
    elena.updateIssue(engIssue, { priority: 4 });
    await waitFor(() => jonas.getStatus().pending.length === 0);

    elena.setNetworkEnabled(true);
    await waitFor(() => elena.getStatus().pending.length === 0 && elena.getStatus().connection === "live");
    await waitFor(() => jonas.pool.get("issue", engIssue)?.priority === 4);
    expect(elena.pool.get("issue", engIssue)?.title).toBe("Edited while Elena was offline");
    expect(elena.pool.get("issue", engIssue)).toEqual(jonas.pool.get("issue", engIssue));

    await jonas.stop();
    await elena.stop();
  });

  it("moves a live socket out of a team's room when the user loses access", async () => {
    const jonas = await stack.login("jonas@lumen.dev");
    const maya = await stack.login("maya@lumen.dev");
    const engTeam = stableId("team:ENG");
    const socket = await stack.socket(jonas.token);
    const writer = await stack.socket(maya.token);
    const resyncs: unknown[] = [];
    const received: SyncDelta[] = [];
    socket.on("sync:resync", (notice: unknown) => resyncs.push(notice));
    socket.on("sync:delta", (delta: SyncDelta) => received.push(delta));

    const { Team } = stack.server.services.models;
    await Team.updateOne({ _id: engTeam }, { $pull: { memberIds: jonas.userId } });
    try {
      await waitFor(() => resyncs.length === 1);
      expect(resyncs[0]).toEqual({ reason: "access_changed" });
      const ack = await writer.emitWithAck("sync:push", {
        txs: [{ clientTxId: crypto.randomUUID(), createdAt: new Date().toISOString(), mutation: { kind: "issue.update", id: engIssue, patch: { title: "Hidden from Jonas" } } }],
      });
      expect(ack.ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).toEqual([]);
    } finally {
      await Team.updateOne({ _id: engTeam }, { $addToSet: { memberIds: jonas.userId } });
    }
  });

  it("disconnects a socket when its token expires", async () => {
    const { userId } = await stack.login("jonas@lumen.dev");
    const user = await stack.server.services.users.findById(userId);
    if (!user) throw new Error("missing user");
    const shortLived = await new SignJWT({ wid: user.workspaceId })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1_000) + 1)
      .sign(new TextEncoder().encode(TEST_JWT_SECRET));
    const socket = await stack.socket(shortLived);
    const reason = await new Promise<string>((resolve) => socket.once("disconnect", resolve));
    expect(reason).toBe("io server disconnect");
  });

  it("rate limits a socket that floods pushes", async () => {
    const { token } = await stack.login("jonas@lumen.dev");
    const socket = await stack.socket(token);
    const batch = () => ({
      txs: Array.from({ length: 100 }, () => ({ clientTxId: crypto.randomUUID(), createdAt: "not a timestamp", mutation: {} })),
    });
    const acks: { ok: boolean; error?: { code: string } }[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) acks.push(await socket.emitWithAck("sync:push", batch()));
    expect(acks.slice(0, 3).every((ack) => ack.ok)).toBe(true);
    expect(acks[3]).toMatchObject({ ok: false, error: { code: "rate_limited" } });
  });
});
