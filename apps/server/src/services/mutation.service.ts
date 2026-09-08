import {
  type EntityWrite,
  type MutationActor,
  type Rejection,
  type SyncDelta,
  type Transaction,
  type TxResult,
  executeMutation,
} from "@tracklane/domain";
import { duplicateKeyFields } from "../errors.js";
import type { Logger } from "../logger.js";
import { type CounterRepository, issueCounterKey, syncCounterKey } from "../repositories/counter.repository.js";
import { EntityIdTakenError, type EntityRepository } from "../repositories/entity.repository.js";
import type { SyncLogRepository } from "../repositories/sync-log.repository.js";
import type { TransactionRunner } from "./transaction-runner.js";

class MutationRejected extends Error {
  constructor(readonly rejection: Rejection) {
    super(rejection.message);
  }
}

export interface MutationServiceDeps {
  transactions: TransactionRunner;
  entities: EntityRepository;
  counters: CounterRepository;
  syncLog: SyncLogRepository;
  logger: Logger;
  clock?: () => Date;
}

function toDelta(write: EntityWrite, syncId: number, tx: Transaction, actor: MutationActor, createdAt: string): SyncDelta {
  const base = {
    syncId,
    modelId: write.id,
    teamId: write.teamId,
    changedFields: write.changedFields,
    clientTxId: tx.clientTxId,
    actorId: actor.userId,
    createdAt,
  };
  if (write.model === "issue") return { ...base, model: "issue", action: "upsert", data: write.data };
  if (write.action === "upsert") return { ...base, model: "comment", action: "upsert", data: write.data };
  return { ...base, model: "comment", action: "remove", data: null };
}

/**
 * The write path. Each transaction runs in its own Mongo transaction so one
 * rejection doesn't sink the rest of a batch:
 *
 *   load refs -> validate + permissions (executeMutation) -> bump the
 *   workspace counter -> write the entity -> append the delta.
 *
 * Fan-out happens elsewhere: the delta publisher tails the sync log's change
 * stream, which yields inserts in commit order, which the counter makes equal
 * to syncId order.
 */
export class MutationService {
  private readonly clock: () => Date;

  constructor(private readonly deps: MutationServiceDeps) {
    this.clock = deps.clock ?? (() => new Date());
  }

  async push(actor: MutationActor, txs: readonly Transaction[]): Promise<TxResult[]> {
    const results: TxResult[] = [];
    for (const tx of txs) results.push(await this.apply(actor, tx));
    return results;
  }

  /** A clientTxId seen before is answered from the log, but only for the actor who sent it. */
  private async replay(actor: MutationActor, clientTxId: string): Promise<TxResult | null> {
    const previous = await this.deps.syncLog.findByClientTxId(actor.workspaceId, clientTxId);
    if (!previous) return null;
    if (previous.actorId !== actor.userId) {
      return { clientTxId, status: "rejected", code: "conflict", message: "Transaction id already used" };
    }
    return { clientTxId, status: "accepted", syncId: previous.syncId };
  }

  private async apply(actor: MutationActor, tx: Transaction): Promise<TxResult> {
    const { transactions, entities, counters, syncLog, logger } = this.deps;
    const replayed = await this.replay(actor, tx.clientTxId);
    if (replayed) return replayed;

    try {
      const outcome = await transactions.run(async (session): Promise<number | null> => {
        const reader = await entities.loadForMutation(actor.workspaceId, tx.mutation, session);
        const { mutation } = tx;
        const issueNumber =
          mutation.kind === "issue.create" && reader.get("team", mutation.input.teamId)
            ? await counters.next(issueCounterKey(mutation.input.teamId), session)
            : 0;
        const now = this.clock().toISOString();
        const result = executeMutation(reader, mutation, { actor, now, allocateIssueNumber: () => issueNumber });
        if (!result.ok) throw new MutationRejected(result.rejection);
        if (!result.write) return null;

        const nextSyncId = await counters.next(syncCounterKey(actor.workspaceId), session);
        await entities.applyWrite(actor.workspaceId, result.write, session);
        await syncLog.insert(actor.workspaceId, toDelta(result.write, nextSyncId, tx, actor, now), session);
        return nextSyncId;
      });
      if (outcome === null) {
        logger.debug({ clientTxId: tx.clientTxId, kind: tx.mutation.kind }, "mutation was a no-op");
        return { clientTxId: tx.clientTxId, status: "noop" };
      }
      logger.debug({ clientTxId: tx.clientTxId, kind: tx.mutation.kind, syncId: outcome }, "mutation accepted");
      return { clientTxId: tx.clientTxId, status: "accepted", syncId: outcome };
    } catch (error) {
      const rejection = this.toRejection(error);
      if (rejection) {
        logger.info({ clientTxId: tx.clientTxId, kind: tx.mutation.kind, ...rejection }, "mutation rejected");
        return { clientTxId: tx.clientTxId, status: "rejected", ...rejection };
      }
      // Two connections replaying the same outbox entry at once: the loser hits the unique index.
      if (duplicateKeyFields(error).includes("clientTxId")) {
        const replay = await this.replay(actor, tx.clientTxId);
        if (replay) return replay;
      }
      throw error;
    }
  }

  private toRejection(error: unknown): Rejection | null {
    if (error instanceof MutationRejected) return error.rejection;
    if (error instanceof EntityIdTakenError) return { code: "conflict", message: `That ${error.model} id is already taken` };
    return null;
  }
}
