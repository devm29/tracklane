import { type ModelName, type SyncDelta, Transaction } from "@tracklane/domain";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { deltaToRecord, type LocalStore, type PersistedState, type SyncCursor } from "./local-store.js";
import type { EntityRecord } from "./object-pool.js";

interface StoredEntity {
  model: ModelName;
  id: string;
  record: EntityRecord;
}

interface StoredTransaction {
  seq?: number;
  clientTxId: string;
  tx: Transaction;
}

interface ReplicaSchema extends DBSchema {
  entities: { key: [string, string]; value: StoredEntity; indexes: { byModel: string } };
  outbox: { key: number; value: StoredTransaction; indexes: { byClientTxId: string } };
  meta: { key: string; value: number | string };
}

const SCHEMA_VERSION = 1;
/**
 * Version of the entity shapes inside the store. Bump it when a deploy changes
 * an entity schema: replicas written by an older build are then treated as
 * absent and re-bootstrapped instead of being read back as the wrong shape.
 */
const RECORD_FORMAT = 2;
const LAST_SYNC_ID = "lastSyncId";
const EPOCH = "epoch";
const FORMAT = "format";

export interface IdbStoreOptions {
  databaseName: string;
  /** Another tab holds an older connection and is stopping an upgrade; ask the user to close it. */
  onBlocked?: () => void;
  /** A newer build in another tab wants to upgrade; this tab's connection was closed and it should reload. */
  onVersionChange?: () => void;
}

function toStored(record: EntityRecord): StoredEntity {
  return { model: record.model, id: record.data.id, record };
}

/** Outbox entries come back from disk written by any past build; anything that no longer parses is dropped. */
function parseOutbox(entries: readonly StoredTransaction[]): Transaction[] {
  return entries.flatMap((entry) => {
    const parsed = Transaction.safeParse(entry.tx);
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * IndexedDB-backed replica. Entities live in one object store keyed by
 * [model, id]; the outbox uses an auto-increment key so insertion order is
 * global across tabs that share the database.
 */
export class IdbStore implements LocalStore {
  private readonly dbPromise: Promise<IDBPDatabase<ReplicaSchema>>;

  constructor(options: IdbStoreOptions) {
    this.dbPromise = openDB<ReplicaSchema>(options.databaseName, SCHEMA_VERSION, {
      upgrade(db) {
        const entities = db.createObjectStore("entities", { keyPath: ["model", "id"] });
        entities.createIndex("byModel", "model");
        const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        outbox.createIndex("byClientTxId", "clientTxId", { unique: true });
        db.createObjectStore("meta");
      },
      blocked: () => options.onBlocked?.(),
      blocking: () => {
        void this.dbPromise.then((db) => db.close());
        options.onVersionChange?.();
      },
    });
  }

  async load(): Promise<PersistedState | null> {
    const db = await this.dbPromise;
    const tx = db.transaction(["entities", "outbox", "meta"], "readonly");
    const meta = tx.objectStore("meta");
    const [format, lastSyncId, epoch, entities, outbox] = await Promise.all([
      meta.get(FORMAT),
      meta.get(LAST_SYNC_ID),
      meta.get(EPOCH),
      tx.objectStore("entities").getAll(),
      tx.objectStore("outbox").getAll(),
      tx.done,
    ]);
    if (format !== RECORD_FORMAT || typeof lastSyncId !== "number" || typeof epoch !== "string") return null;
    return {
      lastSyncId,
      epoch,
      records: entities.map((entity) => entity.record),
      outbox: parseOutbox(outbox),
    };
  }

  async loadOutbox(): Promise<Transaction[]> {
    const db = await this.dbPromise;
    return parseOutbox(await db.getAll("outbox"));
  }

  async replaceSnapshot(records: readonly EntityRecord[], cursor: SyncCursor): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(["entities", "meta"], "readwrite");
    const entities = tx.objectStore("entities");
    const meta = tx.objectStore("meta");
    await entities.clear();
    await Promise.all(records.map((record) => entities.put(toStored(record))));
    await Promise.all([
      meta.put(cursor.lastSyncId, LAST_SYNC_ID),
      meta.put(cursor.epoch, EPOCH),
      meta.put(RECORD_FORMAT, FORMAT),
    ]);
    await tx.done;
  }

  async applyDeltas(deltas: readonly SyncDelta[], lastSyncId: number): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(["entities", "meta"], "readwrite");
    const entities = tx.objectStore("entities");
    const meta = tx.objectStore("meta");
    for (const delta of deltas) {
      const record = deltaToRecord(delta);
      if (record) void entities.put(toStored(record));
      else void entities.delete([delta.model, delta.modelId]);
    }
    const current = await meta.get(LAST_SYNC_ID);
    await meta.put(Math.max(typeof current === "number" ? current : 0, lastSyncId), LAST_SYNC_ID);
    await tx.done;
  }

  async putTransaction(transaction: Transaction): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction("outbox", "readwrite");
    const existing = await tx.store.index("byClientTxId").getKey(transaction.clientTxId);
    if (existing === undefined) await tx.store.add({ clientTxId: transaction.clientTxId, tx: transaction });
    await tx.done;
  }

  async deleteTransactions(clientTxIds: readonly string[]): Promise<void> {
    if (clientTxIds.length === 0) return;
    const db = await this.dbPromise;
    const tx = db.transaction("outbox", "readwrite");
    const index = tx.store.index("byClientTxId");
    for (const id of clientTxIds) {
      const key = await index.getKey(id);
      if (key !== undefined) await tx.store.delete(key);
    }
    await tx.done;
  }

  async clearReplica(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(["entities", "meta"], "readwrite");
    await Promise.all([tx.objectStore("entities").clear(), tx.objectStore("meta").clear(), tx.done]);
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    const tx = db.transaction(["entities", "outbox", "meta"], "readwrite");
    await Promise.all([
      tx.objectStore("entities").clear(),
      tx.objectStore("outbox").clear(),
      tx.objectStore("meta").clear(),
      tx.done,
    ]);
  }

  close(): void {
    void this.dbPromise.then((db) => db.close());
  }
}
