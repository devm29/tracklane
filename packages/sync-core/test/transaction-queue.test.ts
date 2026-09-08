import type { Transaction } from "@tracklane/domain";
import { describe, expect, it } from "vitest";
import { TransactionQueue } from "../src/index.js";
import { fixtureId } from "../src/testing/index.js";

function tx(n: number): Transaction {
  return {
    clientTxId: fixtureId(n),
    createdAt: "2026-01-01T00:00:00.000Z",
    mutation: { kind: "issue.archive", id: fixtureId(100) },
  };
}

describe("TransactionQueue", () => {
  it("batches queued work in order and ignores duplicates", () => {
    const queue = new TransactionQueue();
    expect(queue.enqueue(tx(1))).toBe(true);
    expect(queue.enqueue(tx(1))).toBe(false);
    queue.enqueue(tx(2));
    queue.enqueue(tx(3));
    expect(queue.takeBatch(2).map((t) => t.clientTxId)).toEqual([fixtureId(1), fixtureId(2)]);
    expect(queue.takeBatch(2).map((t) => t.clientTxId)).toEqual([fixtureId(3)]);
    expect(queue.hasQueued()).toBe(false);
  });

  it("requeues in-flight work after a dropped connection", () => {
    const queue = new TransactionQueue();
    queue.enqueue(tx(1));
    queue.takeBatch(10);
    queue.requeueInflight();
    expect(queue.list()[0]?.state).toBe("queued");
  });

  it("drops acknowledged transactions once the replica catches up", () => {
    const queue = new TransactionQueue();
    queue.enqueue(tx(1));
    queue.enqueue(tx(2));
    queue.markAcked(fixtureId(1), 5);
    queue.markAcked(fixtureId(2), 9);
    expect(queue.dropAckedThrough(6)).toEqual([fixtureId(1)]);
    expect(queue.transactions().map((t) => t.clientTxId)).toEqual([fixtureId(2)]);
  });

  it("publishes a new immutable snapshot on every change", () => {
    const queue = new TransactionQueue();
    const empty = queue.list();
    queue.enqueue(tx(1));
    expect(queue.list()).not.toBe(empty);
    expect(Object.isFrozen(queue.list())).toBe(true);
  });
});
