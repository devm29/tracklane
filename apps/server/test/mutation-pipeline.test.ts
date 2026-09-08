import type { Mutation, Transaction } from "@tracklane/domain";
import { initModels } from "../src/db/models.js";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { syncCounterKey } from "../src/repositories/counter.repository.js";
import { actorOf } from "../src/services/access.service.js";
import { stableId } from "../src/seed/seed.js";
import { type TestStack, startStack } from "./stack.js";

let stack: TestStack;
const engIssue = stableId("issue:ENG-1");
const desIssue = stableId("issue:DES-1");
const engTeam = stableId("team:ENG");

beforeAll(async () => {
  stack = await startStack();
});

afterAll(async () => {
  await stack.close();
});

beforeEach(async () => {
  await stack.reseed();
});

async function actor(email: string) {
  const { userId } = await stack.login(email);
  const user = await stack.server.services.users.findById(userId);
  if (!user) throw new Error(`missing user ${email}`);
  return actorOf(user);
}

function tx(mutation: Mutation): Transaction {
  return { clientTxId: crypto.randomUUID(), createdAt: new Date().toISOString(), mutation };
}

async function epoch(): Promise<string> {
  return (await stack.server.services.counters.syncCursor(stack.seed.workspaceId)).epoch;
}

/** A second tenant with one member and one team, sharing the database with the seeded Lumen workspace. */
async function otherWorkspace() {
  const { models } = stack.server.services;
  const workspaceId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const teamId = crypto.randomUUID();
  await models.Workspace.create({ _id: workspaceId, name: "Rival", slug: `rival-${workspaceId.slice(0, 8)}` });
  await models.User.create({
    _id: userId,
    workspaceId,
    name: "Mallory",
    email: `mallory-${userId.slice(0, 8)}@rival.dev`,
    role: "member",
    avatarHue: 10,
    passwordHash: "scrypt$x$y",
  });
  await models.Team.create({ _id: teamId, workspaceId, key: "RIV", name: "Rival", memberIds: [userId] });
  return { actor: { userId, workspaceId, role: "member" as const }, teamId };
}

describe("mutation pipeline", () => {
  it("applies the change, bumps lastSyncId and appends a delta in one transaction", async () => {
    const jonas = await actor("jonas@lumen.dev");
    const [result] = await stack.server.services.mutations.push(jonas, [
      tx({ kind: "issue.update", id: engIssue, patch: { title: "Replica drift after sleep" } }),
    ]);
    expect(result).toMatchObject({ status: "accepted", syncId: 1 });

    const { models, counters } = stack.server.services;
    expect((await models.Issue.findById(engIssue).lean())?.title).toBe("Replica drift after sleep");
    expect(await counters.current(syncCounterKey(stack.seed.workspaceId))).toBe(1);
    const delta = await models.SyncAction.findOne({ syncId: 1 }).lean();
    expect(delta).toMatchObject({ model: "issue", modelId: engIssue, changedFields: ["title"], actorId: jonas.userId });
  });

  it("is idempotent for replayed transactions", async () => {
    const jonas = await actor("jonas@lumen.dev");
    const replay = tx({ kind: "comment.create", id: crypto.randomUUID(), input: { issueId: engIssue, body: "Once" } });
    const first = await stack.server.services.mutations.push(jonas, [replay]);
    const second = await stack.server.services.mutations.push(jonas, [replay]);
    expect(second).toEqual(first);
    expect(await stack.server.services.models.Comment.countDocuments({ body: "Once" })).toBe(1);
  });

  it("never lets another workspace overwrite an issue or comment by reusing its id", async () => {
    const { models } = stack.server.services;
    const rival = await otherWorkspace();
    const lumenComment = await models.Comment.findOne({ workspaceId: stack.seed.workspaceId }).lean();
    if (!lumenComment) throw new Error("seed has no comments");
    const before = await models.Issue.findById(engIssue).lean();

    const createIssue = (id: string): Mutation => ({
      kind: "issue.create",
      id,
      input: {
        teamId: rival.teamId,
        title: "pwned",
        description: "",
        status: "todo",
        priority: 0,
        assigneeId: null,
        projectId: null,
        labelIds: [],
        sortOrder: 0,
      },
    });
    const ownIssue = crypto.randomUUID();

    const results = await stack.server.services.mutations.push(rival.actor, [
      tx(createIssue(engIssue)),
      tx(createIssue(ownIssue)),
      tx({ kind: "comment.create", id: lumenComment._id, input: { issueId: ownIssue, body: "pwned" } }),
    ]);

    expect(results.map((result) => result.status)).toEqual(["rejected", "accepted", "rejected"]);
    expect(results[0]).toMatchObject({ code: "conflict" });
    expect(results[2]).toMatchObject({ code: "conflict" });
    expect(await models.Issue.findById(engIssue).lean()).toEqual(before);
    expect(await models.Comment.findById(lumenComment._id).lean()).toEqual(lumenComment);
    expect(await models.SyncAction.countDocuments({ workspaceId: rival.actor.workspaceId })).toBe(1);
  });

  it("answers a replayed clientTxId only for the actor who sent it", async () => {
    const jonas = await actor("jonas@lumen.dev");
    const maya = await actor("maya@lumen.dev");
    const original = tx({ kind: "issue.update", id: engIssue, patch: { priority: 3 } });
    const [first] = await stack.server.services.mutations.push(jonas, [original]);
    const [stolen] = await stack.server.services.mutations.push(maya, [original]);
    expect(first).toMatchObject({ status: "accepted" });
    expect(stolen).toMatchObject({ status: "rejected", code: "conflict" });
  });

  it("looks up replays through the clientTxId index instead of scanning the log", async () => {
    const { models, syncLog } = stack.server.services;
    const plan: unknown = await models.SyncAction.find(syncLog.clientTxFilter(stack.seed.workspaceId, crypto.randomUUID()))
      .explain("queryPlanner");
    const { winningPlan } = z.object({ queryPlanner: z.object({ winningPlan: z.unknown() }) }).parse(plan).queryPlanner;
    expect(JSON.stringify(winningPlan)).toContain('"indexName":"workspaceId_1_clientTxId_1"');
  });

  it("acknowledges a patch that changes nothing without writing or consuming a syncId", async () => {
    const jonas = await actor("jonas@lumen.dev");
    const current = await stack.server.services.models.Issue.findById(engIssue).lean();
    if (!current) throw new Error("missing issue");
    const [result] = await stack.server.services.mutations.push(jonas, [
      tx({ kind: "issue.update", id: engIssue, patch: { priority: current.priority } }),
    ]);
    expect(result).toMatchObject({ status: "noop" });
    expect(await stack.server.services.counters.current(syncCounterKey(stack.seed.workspaceId))).toBe(0);
    expect(await stack.server.services.models.SyncAction.countDocuments()).toBe(0);
  });

  it("rejects invalid transitions without consuming a syncId", async () => {
    const jonas = await actor("jonas@lumen.dev");
    const backlogIssue = stableId("issue:ENG-7");
    const [result] = await stack.server.services.mutations.push(jonas, [
      tx({ kind: "issue.update", id: backlogIssue, patch: { status: "done" } }),
    ]);
    expect(result).toMatchObject({ status: "rejected", code: "invalid_transition" });
    expect(await stack.server.services.counters.current(syncCounterKey(stack.seed.workspaceId))).toBe(0);
  });

  it("enforces team permissions in the pipeline", async () => {
    const diego = await actor("diego@lumen.dev");
    const [result] = await stack.server.services.mutations.push(diego, [
      tx({ kind: "issue.update", id: engIssue, patch: { priority: 1 } }),
    ]);
    expect(result).toMatchObject({ status: "rejected", code: "forbidden" });
  });

  it("hands out gap-free syncIds and issue numbers under concurrent writers", async () => {
    const people = await Promise.all(["maya@lumen.dev", "jonas@lumen.dev", "priya@lumen.dev", "elena@lumen.dev"].map(actor));
    const writes = Array.from({ length: 24 }, (_, index) => {
      const who = people[index % people.length];
      if (!who) throw new Error("missing actor");
      return stack.server.services.mutations.push(who, [
        tx({
          kind: "issue.create",
          id: crypto.randomUUID(),
          input: {
            teamId: engTeam,
            title: `Concurrent issue ${index}`,
            description: "",
            status: "todo",
            priority: 0,
            assigneeId: null,
            projectId: null,
            labelIds: [],
            sortOrder: index,
          },
        }),
      ]);
    });
    const results = (await Promise.all(writes)).flat();
    const syncIds = results.map((result) => (result.status === "accepted" ? result.syncId : -1)).sort((a, b) => a - b);
    expect(syncIds).toEqual(Array.from({ length: 24 }, (_, index) => index + 1));

    const numbers = (await stack.server.services.models.Issue.find({ title: /^Concurrent issue/ }).lean()).map((issue) => issue.number);
    expect(new Set(numbers).size).toBe(24);
    expect(Math.min(...numbers)).toBe(21);
    expect(Math.max(...numbers)).toBe(44);
  });
});

describe("catch-up and bootstrap", () => {
  it("filters deltas to the caller's teams", async () => {
    const maya = await actor("maya@lumen.dev");
    await stack.server.services.mutations.push(maya, [
      tx({ kind: "issue.update", id: engIssue, patch: { title: "Catch-up A" } }),
      tx({ kind: "issue.update", id: desIssue, patch: { title: "Catch-up B" } }),
    ]);
    const designTeam = stableId("team:DES");
    const response = await stack.server.services.catchUp.catchUp(stack.seed.workspaceId, [designTeam], 0, await epoch());
    expect(response.kind).toBe("deltas");
    if (response.kind !== "deltas") return;
    expect(response.lastSyncId).toBe(2);
    expect(response.deltas.map((delta) => delta.modelId)).toEqual([desIssue]);
  });

  it("asks for a re-bootstrap once the requested range has been compacted", async () => {
    const maya = await actor("maya@lumen.dev");
    await stack.server.services.mutations.push(maya, [
      tx({ kind: "issue.update", id: engIssue, patch: { title: "First" } }),
      tx({ kind: "issue.update", id: engIssue, patch: { title: "Second" } }),
    ]);
    await stack.server.services.models.SyncAction.deleteOne({ syncId: 1 });
    const teams = [engTeam];
    expect((await stack.server.services.catchUp.catchUp(stack.seed.workspaceId, teams, 0, await epoch())).kind).toBe("rebootstrap");
    expect((await stack.server.services.catchUp.catchUp(stack.seed.workspaceId, teams, 1, await epoch())).kind).toBe("deltas");
  });

  it("asks clients from a previous epoch to re-bootstrap even when their cursor looks valid", async () => {
    const maya = await actor("maya@lumen.dev");
    const stale = await epoch();
    await stack.reseed();
    await stack.server.services.mutations.push(maya, [
      tx({ kind: "issue.update", id: engIssue, patch: { title: "First" } }),
      tx({ kind: "issue.update", id: engIssue, patch: { title: "Second" } }),
    ]);
    const { catchUp } = stack.server.services;
    expect((await catchUp.catchUp(stack.seed.workspaceId, [engTeam], 1, stale)).kind).toBe("rebootstrap");
    expect((await catchUp.catchUp(stack.seed.workspaceId, [engTeam], 1, await epoch())).kind).toBe("deltas");
  });

  it("returns the workspace counter as lastSyncId even when no visible delta reaches it", async () => {
    const maya = await actor("maya@lumen.dev");
    await stack.server.services.mutations.push(maya, [tx({ kind: "issue.update", id: engIssue, patch: { title: "Quiet elsewhere" } })]);
    const response = await stack.server.services.catchUp.catchUp(stack.seed.workspaceId, [stableId("team:DES")], 0, await epoch());
    expect(response).toEqual({ kind: "deltas", deltas: [], lastSyncId: 1 });
  });

  it("updates the sync log TTL in place when the retention setting changes", async () => {
    const { models } = stack.server.services;
    const ttl = async () => (await models.SyncAction.collection.indexes()).find((index) => index.name === "createdAt_ttl");
    await initModels(models, { syncLogRetentionDays: 3 });
    expect((await ttl())?.expireAfterSeconds).toBe(3 * 86_400);
    await initModels(models, { syncLogRetentionDays: 14 });
    expect((await ttl())?.expireAfterSeconds).toBe(14 * 86_400);
  });

  it("returns a bootstrap scoped to the user's teams with a matching lastSyncId", async () => {
    const { token } = await stack.login("diego@lumen.dev");
    const response = await fetch(`${stack.url}/api/sync/bootstrap`, { headers: { authorization: `Bearer ${token}` } });
    const body = (await response.json()) as { lastSyncId: number; epoch: string; teams: { key: string }[]; issues: unknown[] };
    expect(response.status).toBe(200);
    expect(body.lastSyncId).toBe(0);
    expect(body.epoch).toBe(await epoch());
    expect(body.teams.map((team) => team.key)).toEqual(["DES"]);
    expect(body.issues).toHaveLength(10);
  });
});
