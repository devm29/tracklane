import { type Mutation, issueStatuses } from "@tracklane/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { MemoryStore, MutationRejectedError, SyncClient } from "../src/index.js";
import { InMemorySyncServer, ScriptedTransport, fixtureId, sequentialIds, smallWorkspace } from "../src/testing/index.js";
import { must } from "./helpers.js";

const fixture = smallWorkspace();
const ada = must(fixture.users[0], "ada");
const grace = must(fixture.users[1], "grace");
const linus = must(fixture.users[2], "linus");

// Ada runs two independent devices, so the same user also races herself.
const replicaUsers = [ada.id, ada.id, grace.id, linus.id];
const teamIds = fixture.teams.map((team) => team.id);
const userIds = fixture.users.map((user) => user.id);
const labelIds = fixture.labels.map((label) => label.id);
const newIssueIds = [200, 201, 202, 203].map(fixtureId);
const existingIssueIds = fixture.issues.map((issue) => issue.id);
const issueIds = [...existingIssueIds, ...existingIssueIds, ...newIssueIds];
const commentIds = [300, 301, 302, 303].map(fixtureId);

const title = fc.constantFrom("Fix sync", "Polish board", "Ship offline mode", "Rename column", "Tune latency");
const status = fc.constantFrom(...issueStatuses);
const priority = fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const, 4 as const);
const nullableUser = fc.option(fc.constantFrom(...userIds), { nil: null });

const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("issue.create" as const),
      id: fc.constantFrom(...newIssueIds),
      input: fc.record({
        teamId: fc.constantFrom(...teamIds),
        title,
        description: fc.constant(""),
        status,
        priority,
        assigneeId: nullableUser,
        projectId: fc.constant(null),
        labelIds: fc.subarray(labelIds),
        sortOrder: fc.integer({ min: -5_000, max: 5_000 }),
      }),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant("issue.update" as const),
      id: fc.constantFrom(...issueIds),
      patch: fc.oneof(
        { weight: 3, arbitrary: fc.record({ title }) },
        { weight: 3, arbitrary: fc.record({ priority }) },
        { weight: 2, arbitrary: fc.record({ sortOrder: fc.integer() }) },
        { weight: 2, arbitrary: fc.record({ labelIds: fc.subarray(labelIds) }) },
        { weight: 3, arbitrary: fc.record({ status }) },
        { weight: 1, arbitrary: fc.record({ assigneeId: nullableUser }) },
        { weight: 2, arbitrary: fc.record({ title, priority, status }) },
      ),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("issue.archive" as const), id: fc.constantFrom(...issueIds) }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("issue.unarchive" as const), id: fc.constantFrom(...issueIds) }) },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("comment.create" as const),
      id: fc.constantFrom(...commentIds),
      input: fc.record({ issueId: fc.constantFrom(...issueIds), body: fc.constantFrom("LGTM", "Needs a test", "On it") }),
    }),
  },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant("comment.delete" as const), id: fc.constantFrom(...commentIds) }) },
);

type Command =
  | { type: "mutate"; replica: number; mutation: Mutation }
  | { type: "request" | "response" | "inbound" | "drop" | "restore"; replica: number }
  | { type: "compact" };

const replica = fc.nat({ max: replicaUsers.length - 1 });
const commandArb: fc.Arbitrary<Command> = fc.oneof(
  { weight: 8, arbitrary: fc.record({ type: fc.constant("mutate" as const), replica, mutation: mutationArb }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant("request" as const), replica }) },
  { weight: 3, arbitrary: fc.record({ type: fc.constant("response" as const), replica }) },
  { weight: 4, arbitrary: fc.record({ type: fc.constant("inbound" as const), replica }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("drop" as const), replica }) },
  { weight: 1, arbitrary: fc.record({ type: fc.constant("restore" as const), replica }) },
  { weight: 1, arbitrary: fc.constant({ type: "compact" as const }) },
);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function byId<T extends { id: string }>(entities: readonly T[]): T[] {
  return [...entities].sort((a, b) => a.id.localeCompare(b.id));
}

interface Replica {
  transport: ScriptedTransport;
  client: SyncClient;
}

async function quiesce(replicas: readonly Replica[]): Promise<void> {
  for (const { transport } of replicas) transport.restoreLink();
  for (let round = 0; round < 500; round += 1) {
    let progressed = false;
    for (const { transport } of replicas) {
      progressed = transport.deliverInbound() || progressed;
      progressed = transport.deliverRequest() || progressed;
      progressed = transport.deliverResponse() || progressed;
    }
    await tick();
    const settled = replicas.every(
      ({ client }) => client.getStatus().connection === "live" && client.getStatus().pending.length === 0,
    );
    if (!progressed && settled) return;
    if (!progressed) await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

async function runScenario(commands: readonly Command[]): Promise<void> {
  const server = new InMemorySyncServer(structuredClone(fixture));
  const replicas = replicaUsers.map((userId, index) => {
    const transport = new ScriptedTransport(server, userId, "manual");
    const client = new SyncClient({
      actor: server.actorFor(userId),
      store: new MemoryStore(),
      transport,
      retryDelayMs: 1,
      newId: sequentialIds(1_000_000 * (index + 1)),
    });
    return { userId, transport, client };
  });
  await Promise.all(replicas.map(({ client }) => client.start()));
  await quiesce(replicas);

  for (const command of commands) {
    if (command.type === "compact") {
      server.compact();
      continue;
    }
    const target = replicas[command.replica];
    if (!target) continue;
    switch (command.type) {
      case "mutate":
        try {
          target.client.mutate(command.mutation);
        } catch (error) {
          if (!(error instanceof MutationRejectedError)) throw error;
        }
        break;
      case "request":
        target.transport.deliverRequest();
        break;
      case "response":
        target.transport.deliverResponse();
        break;
      case "inbound":
        target.transport.deliverInbound();
        break;
      case "drop":
        target.transport.dropLink();
        break;
      case "restore":
        target.transport.restoreLink();
        break;
    }
    await tick();
  }

  await quiesce(replicas);
  for (const { userId, client } of replicas) {
    const status = client.getStatus();
    expect(status.connection).toBe("live");
    expect(status.pending).toEqual([]);
    expect(byId(client.pool.all("issue"))).toEqual(byId(server.visibleEntities(userId, "issue")));
    expect(byId(client.pool.all("comment"))).toEqual(byId(server.visibleEntities(userId, "comment")));
  }
  await Promise.all(replicas.map(({ client }) => client.stop()));
}

describe("replica convergence", () => {
  it("every replica matches the server after arbitrary interleavings, drops and compactions", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(commandArb, { minLength: 20, maxLength: 150, size: "medium" }), (commands) => runScenario(commands)),
      { numRuns: 150 },
    );
  });

  it("optimistic state equals confirmed state plus the pending queue", async () => {
    const server = new InMemorySyncServer(structuredClone(fixture));
    const transport = new ScriptedTransport(server, grace.id, "manual");
    const client = new SyncClient({ actor: server.actorFor(grace.id), store: new MemoryStore(), transport });
    await client.start();
    transport.deliverInbound();
    await tick();
    transport.deliverRequest();
    transport.deliverResponse();
    await tick();
    expect(client.getStatus().connection).toBe("live");

    const issueId = fixture.issues[0]?.id ?? "";
    client.updateIssue(issueId, { title: "Optimistic title" });
    expect(client.pool.get("issue", issueId)?.title).toBe("Optimistic title");
    expect(client.pool.getConfirmed("issue", issueId)?.title).toBe("Sync engine");

    // A teammate changes a different field first; the pending title must survive the rebase.
    server.push(ada.id, [
      {
        clientTxId: fixtureId(9_000),
        createdAt: new Date().toISOString(),
        mutation: { kind: "issue.update", id: issueId, patch: { priority: 1 } },
      },
    ]);
    transport.deliverInbound();
    await tick();
    const view = client.pool.get("issue", issueId);
    expect(view?.priority).toBe(1);
    expect(view?.title).toBe("Optimistic title");

    await tick();
    transport.deliverRequest();
    transport.deliverResponse();
    transport.deliverInbound();
    await tick();
    expect(client.getStatus().pending).toHaveLength(0);
    expect(client.pool.getConfirmed("issue", issueId)?.title).toBe("Optimistic title");
    await client.stop();
  });
});
