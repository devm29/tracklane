import { afterEach, describe, expect, it } from "vitest";
import { MemoryStore, MutationRejectedError, SyncClient } from "../src/index.js";
import { InMemorySyncServer, ScriptedTransport, sequentialIds, smallWorkspace } from "../src/testing/index.js";
import { must, waitFor } from "./helpers.js";

const fixture = smallWorkspace();
const [ada, grace, linus] = fixture.users;
const coreIssue = must(fixture.issues[0], "core issue");
const webIssue = must(fixture.issues[2], "web issue");
const [core, web] = fixture.teams;

const running: SyncClient[] = [];

afterEach(async () => {
  await Promise.all(running.splice(0).map((client) => client.stop()));
});

async function replica(server: InMemorySyncServer, userId: string, store = new MemoryStore()) {
  const transport = new ScriptedTransport(server, userId, "auto");
  const client = new SyncClient({
    actor: server.actorFor(userId),
    store,
    transport,
    newId: sequentialIds(Math.floor(Math.random() * 1_000_000_000)),
    retryDelayMs: 5,
  });
  running.push(client);
  await client.start();
  await waitFor(() => client.getStatus().connection === "live");
  return { client, transport, store };
}

describe("SyncClient", () => {
  it("moves its cursor to the server's position after catch-up even when every delta was for another team", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const { client, transport } = await replica(server, must(grace).id);
    transport.dropLink();
    const linusId = must(linus).id;
    for (let index = 0; index < 5; index += 1) {
      server.push(linusId, [
        {
          clientTxId: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          mutation: { kind: "issue.update", id: webIssue.id, patch: { title: `Web change ${index}` } },
        },
      ]);
    }
    transport.restoreLink();
    await waitFor(() => client.getStatus().connection === "live");
    expect(client.getStatus().lastSyncId).toBe(server.lastSyncId);
    expect(client.pool.get("issue", webIssue.id)).toBeUndefined();
  });

  it("re-bootstraps instead of catching up across a server epoch change", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const { client, transport } = await replica(server, must(ada).id);
    client.updateIssue(coreIssue.id, { title: "Old epoch" });
    await waitFor(() => client.getStatus().pending.length === 0);

    transport.dropLink();
    server.reset(structuredClone(fixture));
    server.push(must(ada).id, [
      {
        clientTxId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        mutation: { kind: "issue.update", id: webIssue.id, patch: { title: "New epoch" } },
      },
    ]);
    transport.restoreLink();

    await waitFor(() => client.getStatus().connection === "live");
    expect(client.pool.get("issue", coreIssue.id)?.title).toBe(coreIssue.title);
    expect(client.pool.get("issue", webIssue.id)?.title).toBe("New epoch");
  });

  it("drops a team's data when the server says access changed", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const graceId = must(grace).id;
    const { client } = await replica(server, graceId);
    expect(client.pool.get("issue", coreIssue.id)).toBeDefined();

    server.setMembership(must(core).id, graceId, false);
    server.setMembership(must(web).id, graceId, true);
    await waitFor(() => client.pool.get("issue", coreIssue.id) === undefined);
    expect(client.pool.get("issue", webIssue.id)).toBeDefined();
  });

  it("doesn't queue a change that changes nothing", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const { client } = await replica(server, must(ada).id);
    expect(client.mutate({ kind: "issue.update", id: coreIssue.id, patch: { priority: coreIssue.priority } })).toBeNull();
    expect(client.getStatus().pending).toHaveLength(0);
    expect(server.lastSyncId).toBe(0);
  });

  it("reports invalid input as a validation rejection rather than a schema exception", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const { client } = await replica(server, must(ada).id);
    const attempt = () => client.addComment({ issueId: coreIssue.id, body: "x".repeat(5_001) });
    expect(attempt).toThrow(MutationRejectedError);
    expect(attempt).toThrow(expect.objectContaining({ code: "validation" }));
  });
});
