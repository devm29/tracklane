import "fake-indexeddb/auto";
import type { SyncDelta, Transaction } from "@tracklane/domain";
import { openDB } from "idb";
import { describe, expect, it } from "vitest";
import { IdbStore } from "../src/index.js";
import { fixtureId, smallWorkspace } from "../src/testing/index.js";
import { must } from "./helpers.js";

const fixture = smallWorkspace();
const issue = must(fixture.issues[0], "fixture issue");

let counter = 0;
const freshStore = (): IdbStore => new IdbStore({ databaseName: `test-${++counter}` });

function tx(n: number): Transaction {
  return { clientTxId: fixtureId(n), createdAt: "2026-01-01T00:00:00.000Z", mutation: { kind: "issue.archive", id: issue.id } };
}

describe("IdbStore", () => {
  it("reports an empty replica before the first bootstrap", async () => {
    expect(await freshStore().load()).toBeNull();
  });

  it("persists snapshots and applies deltas on top", async () => {
    const store = freshStore();
    await store.replaceSnapshot(
      fixture.issues.map((data) => ({ model: "issue" as const, data })),
      { lastSyncId: 7, epoch: "e1" },
    );
    const delta: SyncDelta = {
      syncId: 8,
      model: "issue",
      action: "upsert",
      modelId: issue.id,
      teamId: issue.teamId,
      data: { ...issue, title: "From the server" },
      changedFields: ["title"],
      clientTxId: null,
      actorId: issue.creatorId,
      createdAt: "2026-01-01T00:00:01.000Z",
    };
    await store.applyDeltas([delta], 8);

    const state = await store.load();
    expect(state?.lastSyncId).toBe(8);
    expect(state?.epoch).toBe("e1");
    expect(state?.records).toHaveLength(fixture.issues.length);
    const stored = state?.records.find((record) => record.data.id === issue.id);
    expect(stored?.model === "issue" && stored.data.title).toBe("From the server");
  });

  it("keeps the outbox in insertion order and deduplicates by clientTxId", async () => {
    const store = freshStore();
    await store.putTransaction(tx(3));
    await store.putTransaction(tx(1));
    await store.putTransaction(tx(3));
    await store.putTransaction(tx(2));
    expect((await store.loadOutbox()).map((t) => t.clientTxId)).toEqual([fixtureId(3), fixtureId(1), fixtureId(2)]);

    await store.deleteTransactions([fixtureId(1)]);
    expect((await store.loadOutbox()).map((t) => t.clientTxId)).toEqual([fixtureId(3), fixtureId(2)]);
  });

  it("removes comments on a remove delta", async () => {
    const store = freshStore();
    const comment = {
      id: fixtureId(500),
      workspaceId: issue.workspaceId,
      teamId: issue.teamId,
      issueId: issue.id,
      authorId: issue.creatorId,
      body: "hello",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    await store.replaceSnapshot([{ model: "comment", data: comment }], { lastSyncId: 1, epoch: "e1" });
    await store.applyDeltas(
      [
        {
          syncId: 2,
          model: "comment",
          action: "remove",
          modelId: comment.id,
          teamId: comment.teamId,
          data: null,
          changedFields: [],
          clientTxId: null,
          actorId: comment.authorId,
          createdAt: "2026-01-01T00:00:01.000Z",
        },
      ],
      2,
    );
    expect((await store.load())?.records).toEqual([]);
  });

  it("treats a replica written in an older record format as absent but keeps its outbox", async () => {
    const name = `tracklane-test-${crypto.randomUUID()}`;
    const store = new IdbStore({ databaseName: name });
    await store.replaceSnapshot([{ model: "issue", data: issue }], { lastSyncId: 3, epoch: "e1" });
    await store.putTransaction(tx(1));
    store.close();

    const raw = await openDB(name, 1);
    await raw.put("meta", 1, "format");
    await raw.add("outbox", { clientTxId: "garbage", tx: { clientTxId: "garbage" } });
    raw.close();

    const reopened = new IdbStore({ databaseName: name });
    expect(await reopened.load()).toBeNull();
    expect((await reopened.loadOutbox()).map((t) => t.clientTxId)).toEqual([fixtureId(1)]);
    reopened.close();
  });

  it("can forget the replica while keeping unsent transactions", async () => {
    const store = freshStore();
    await store.replaceSnapshot([{ model: "issue", data: issue }], { lastSyncId: 4, epoch: "e1" });
    await store.putTransaction(tx(1));
    await store.clearReplica();
    expect(await store.load()).toBeNull();
    expect((await store.loadOutbox()).map((t) => t.clientTxId)).toEqual([fixtureId(1)]);
    await store.clear();
    expect(await store.loadOutbox()).toEqual([]);
  });
});
