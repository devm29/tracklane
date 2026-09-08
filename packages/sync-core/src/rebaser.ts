import type { AnyEntity, EntityReader, ExecuteOptions, ModelMap, ModelName, MutationActor, Transaction } from "@tracklane/domain";
import { executeMutation } from "@tracklane/domain";
import { entityKey, type EntityKey, type Overlay } from "./object-pool.js";

export interface RebaseResult {
  overlay: Overlay;
  /** Transactions that no longer apply on top of current server state; they stay queued for the server to judge. */
  conflicted: string[];
}

export interface ApplyContext {
  actor: MutationActor;
}

class OverlayReader implements EntityReader {
  readonly overlay = new Map<EntityKey, AnyEntity | null>();

  constructor(private readonly base: EntityReader) {}

  get<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined {
    const key = entityKey(model, id);
    if (this.overlay.has(key)) return (this.overlay.get(key) ?? undefined) as ModelMap[M] | undefined;
    return this.base.get(model, id);
  }
}

function optimisticOptions(actor: MutationActor, tx: Transaction): ExecuteOptions {
  // Issue numbers are allocated by the server; 0 renders as a pending identifier until the delta lands.
  return { actor, now: tx.createdAt, allocateIssueNumber: () => 0 };
}

/**
 * Replays pending transactions, in order, on top of confirmed state. Because
 * this reuses the server's mutation engine, the optimistic view is exactly
 * what the server would produce if it processed the queue right now.
 */
export function rebase(confirmed: EntityReader, pending: readonly Transaction[], context: ApplyContext): RebaseResult {
  const reader = new OverlayReader(confirmed);
  const conflicted: string[] = [];
  for (const tx of pending) {
    const result = executeMutation(reader, tx.mutation, optimisticOptions(context.actor, tx));
    if (!result.ok) {
      conflicted.push(tx.clientTxId);
      continue;
    }
    const { write } = result;
    if (!write) continue;
    reader.overlay.set(entityKey(write.model, write.id), write.data);
  }
  return { overlay: reader.overlay, conflicted };
}

export function tryApply(reader: EntityReader, tx: Transaction, context: ApplyContext): ReturnType<typeof executeMutation> {
  return executeMutation(reader, tx.mutation, optimisticOptions(context.actor, tx));
}
