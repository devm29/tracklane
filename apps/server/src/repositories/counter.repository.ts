import { randomUUID } from "node:crypto";
import type { ClientSession } from "mongoose";
import type { CounterDoc, Models } from "../db/models.js";

export const syncCounterKey = (workspaceId: string): string => `sync:${workspaceId}`;
export const issueCounterKey = (teamId: string): string => `issue:${teamId}`;
export const INITIAL_EPOCH = "initial";

export interface SyncCursor {
  lastSyncId: number;
  epoch: string;
}

export class CounterRepository {
  constructor(private readonly models: Models) {}

  /** Atomic increment. Inside a transaction the counter document also serialises concurrent writers. */
  async next(key: string, session: ClientSession): Promise<number> {
    const doc = await this.models.Counter.findOneAndUpdate(
      { _id: key },
      { $inc: { value: 1 }, $setOnInsert: { epoch: INITIAL_EPOCH } },
      { upsert: true, returnDocument: "after", session },
    ).lean<CounterDoc>();
    return doc.value;
  }

  async current(key: string, session?: ClientSession): Promise<number> {
    const doc = await this.models.Counter.findById(key)
      .session(session ?? null)
      .lean<CounterDoc>();
    return doc?.value ?? 0;
  }

  /** The workspace's sync position and epoch; a workspace nobody has written to yet is at 0 in the initial epoch. */
  async syncCursor(workspaceId: string, session?: ClientSession): Promise<SyncCursor> {
    const doc = await this.models.Counter.findById(syncCounterKey(workspaceId))
      .session(session ?? null)
      .lean<CounterDoc>();
    return { lastSyncId: doc?.value ?? 0, epoch: doc?.epoch ?? INITIAL_EPOCH };
  }

  /** Gives counters created before epochs existed one, so their clients get a clean re-bootstrap once. */
  async backfillEpochs(): Promise<void> {
    const missing = await this.models.Counter.find({ _id: /^sync:/, epoch: { $exists: false } }, { _id: 1 }).lean<
      Pick<CounterDoc, "_id">[]
    >();
    for (const { _id } of missing) {
      await this.models.Counter.updateOne({ _id, epoch: { $exists: false } }, { $set: { epoch: randomUUID() } });
    }
  }
}
