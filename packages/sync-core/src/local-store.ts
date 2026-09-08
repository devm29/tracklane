import type { SyncDelta, Transaction } from "@tracklane/domain";
import type { EntityRecord } from "./object-pool.js";

export interface SyncCursor {
  lastSyncId: number;
  epoch: string;
}

export interface PersistedState extends SyncCursor {
  records: EntityRecord[];
  outbox: Transaction[];
}

/**
 * Durable replica storage. Every tab of a workspace shares one store, so
 * implementations must tolerate concurrent writers to the outbox.
 */
export interface LocalStore {
  /** Returns null when the workspace has never been bootstrapped on this device. */
  load(): Promise<PersistedState | null>;
  loadOutbox(): Promise<Transaction[]>;
  replaceSnapshot(records: readonly EntityRecord[], cursor: SyncCursor): Promise<void>;
  applyDeltas(deltas: readonly SyncDelta[], lastSyncId: number): Promise<void>;
  putTransaction(tx: Transaction): Promise<void>;
  deleteTransactions(clientTxIds: readonly string[]): Promise<void>;
  /** Forgets the replica but keeps unsent transactions. */
  clearReplica(): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}

export function deltaToRecord(delta: SyncDelta): EntityRecord | null {
  switch (delta.model) {
    case "issue":
      return { model: "issue", data: delta.data };
    case "comment":
      return delta.action === "upsert" ? { model: "comment", data: delta.data } : null;
  }
}

export class MemoryStore implements LocalStore {
  private records = new Map<string, EntityRecord>();
  private outbox: Transaction[] = [];
  private cursor: SyncCursor | null = null;

  async load(): Promise<PersistedState | null> {
    await Promise.resolve();
    if (this.cursor === null) return null;
    return { ...this.cursor, records: [...this.records.values()], outbox: [...this.outbox] };
  }

  async loadOutbox(): Promise<Transaction[]> {
    await Promise.resolve();
    return [...this.outbox];
  }

  async replaceSnapshot(records: readonly EntityRecord[], cursor: SyncCursor): Promise<void> {
    await Promise.resolve();
    this.records = new Map(records.map((record) => [`${record.model}:${record.data.id}`, record]));
    this.cursor = { ...cursor };
  }

  async applyDeltas(deltas: readonly SyncDelta[], lastSyncId: number): Promise<void> {
    await Promise.resolve();
    for (const delta of deltas) {
      const key = `${delta.model}:${delta.modelId}`;
      const record = deltaToRecord(delta);
      if (record) this.records.set(key, record);
      else this.records.delete(key);
    }
    if (this.cursor) this.cursor.lastSyncId = Math.max(this.cursor.lastSyncId, lastSyncId);
  }

  async putTransaction(tx: Transaction): Promise<void> {
    await Promise.resolve();
    if (!this.outbox.some((existing) => existing.clientTxId === tx.clientTxId)) this.outbox.push(tx);
  }

  async deleteTransactions(clientTxIds: readonly string[]): Promise<void> {
    await Promise.resolve();
    const ids = new Set(clientTxIds);
    this.outbox = this.outbox.filter((tx) => !ids.has(tx.clientTxId));
  }

  async clearReplica(): Promise<void> {
    await Promise.resolve();
    this.records.clear();
    this.cursor = null;
  }

  async clear(): Promise<void> {
    await Promise.resolve();
    this.records.clear();
    this.outbox = [];
    this.cursor = null;
  }

  close(): void {}
}
