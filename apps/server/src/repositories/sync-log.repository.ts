import { SyncDelta } from "@tracklane/domain";
import type { ClientSession } from "mongoose";
import type { Models, SyncActionDoc } from "../db/models.js";

export function toDelta(doc: SyncActionDoc): SyncDelta {
  return SyncDelta.parse({
    syncId: doc.syncId,
    model: doc.model,
    action: doc.action,
    modelId: doc.modelId,
    teamId: doc.teamId,
    data: doc.data,
    changedFields: doc.changedFields,
    clientTxId: doc.clientTxId,
    actorId: doc.actorId,
    createdAt: doc.createdAt.toISOString(),
  });
}

export function fromDelta(workspaceId: string, delta: SyncDelta): SyncActionDoc {
  return {
    workspaceId,
    syncId: delta.syncId,
    model: delta.model,
    action: delta.action,
    modelId: delta.modelId,
    teamId: delta.teamId,
    data: delta.data,
    changedFields: delta.changedFields,
    clientTxId: delta.clientTxId,
    actorId: delta.actorId,
    createdAt: new Date(delta.createdAt),
  };
}

export class SyncLogRepository {
  constructor(private readonly models: Models) {}

  async insert(workspaceId: string, delta: SyncDelta, session: ClientSession): Promise<void> {
    await this.models.SyncAction.create([fromDelta(workspaceId, delta)], { session });
  }

  /**
   * The `$type` clause is what lets the planner use the partial unique index on
   * clientTxId; a bare equality doesn't imply its filter expression, and the
   * query would fall back to scanning the workspace's whole retained log.
   */
  async findByClientTxId(workspaceId: string, clientTxId: string): Promise<{ syncId: number; actorId: string } | null> {
    return this.models.SyncAction.findOne(this.clientTxFilter(workspaceId, clientTxId), { _id: 0, syncId: 1, actorId: 1 }).lean<
      Pick<SyncActionDoc, "syncId" | "actorId">
    >();
  }

  clientTxFilter(workspaceId: string, clientTxId: string) {
    return { workspaceId, clientTxId: { $eq: clientTxId, $type: "string" as const } };
  }

  async countRange(workspaceId: string, afterSyncId: number, upToSyncId: number): Promise<number> {
    return this.models.SyncAction.countDocuments({ workspaceId, syncId: { $gt: afterSyncId, $lte: upToSyncId } });
  }

  async listRange(
    workspaceId: string,
    afterSyncId: number,
    upToSyncId: number,
    teamIds: readonly string[],
  ): Promise<SyncDelta[]> {
    const docs = await this.models.SyncAction.find({
      workspaceId,
      syncId: { $gt: afterSyncId, $lte: upToSyncId },
      teamId: { $in: teamIds },
    })
      .sort({ syncId: 1 })
      .lean<SyncActionDoc[]>();
    return docs.map(toDelta);
  }
}
