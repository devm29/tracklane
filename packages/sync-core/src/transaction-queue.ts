import type { Transaction } from "@tracklane/domain";

export type PendingState = "queued" | "inflight" | "acked";

export interface PendingTransaction {
  readonly tx: Transaction;
  readonly state: PendingState;
  /** Server-assigned syncId once accepted; the entry is dropped when the replica catches up to it. */
  readonly ackedSyncId: number | null;
}

/**
 * Ordered outbox of transactions that have been applied optimistically but are
 * not yet reflected in confirmed state. Order matters: rebasing replays these
 * in sequence, and the server receives them in the same order.
 */
export class TransactionQueue {
  private items: PendingTransaction[] = [];
  private snapshot: readonly PendingTransaction[] = [];

  get size(): number {
    return this.items.length;
  }

  list(): readonly PendingTransaction[] {
    return this.snapshot;
  }

  transactions(): Transaction[] {
    return this.items.map((item) => item.tx);
  }

  hasQueued(): boolean {
    return this.items.some((item) => item.state === "queued");
  }

  has(clientTxId: string): boolean {
    return this.items.some((item) => item.tx.clientTxId === clientTxId);
  }

  enqueue(tx: Transaction): boolean {
    if (this.has(tx.clientTxId)) return false;
    this.items.push({ tx, state: "queued", ackedSyncId: null });
    this.publish();
    return true;
  }

  /**
   * Adopts a persisted outbox as the order of record. Entries this queue holds
   * that the store doesn't (yet) are appended when `keepUnstored` says they
   * are still pending, since a write may still be on its way to the store.
   * Acknowledgements already received are kept so nothing is pushed twice.
   */
  reconcile(stored: readonly Transaction[], keepUnstored: (clientTxId: string) => boolean = () => false): void {
    const current = new Map(this.items.map((item) => [item.tx.clientTxId, item]));
    const seen = new Set<string>();
    const next: PendingTransaction[] = [];
    for (const tx of stored) {
      if (seen.has(tx.clientTxId)) continue;
      seen.add(tx.clientTxId);
      const existing = current.get(tx.clientTxId);
      next.push(existing?.state === "acked" ? existing : { tx, state: "queued", ackedSyncId: null });
    }
    for (const item of this.items) {
      if (seen.has(item.tx.clientTxId) || !keepUnstored(item.tx.clientTxId)) continue;
      next.push(item.state === "inflight" ? { ...item, state: "queued" } : item);
    }
    this.items = next;
    this.publish();
  }

  takeBatch(max: number): Transaction[] {
    const batch: Transaction[] = [];
    this.items = this.items.map((item) => {
      if (item.state !== "queued" || batch.length >= max) return item;
      batch.push(item.tx);
      return { ...item, state: "inflight" };
    });
    if (batch.length > 0) this.publish();
    return batch;
  }

  requeueInflight(ids?: ReadonlySet<string>): void {
    const affected = (item: PendingTransaction): boolean =>
      item.state === "inflight" && (!ids || ids.has(item.tx.clientTxId));
    if (!this.items.some(affected)) return;
    this.items = this.items.map((item) => (affected(item) ? { ...item, state: "queued" } : item));
    this.publish();
  }

  markAcked(clientTxId: string, syncId: number): void {
    this.items = this.items.map((item) =>
      item.tx.clientTxId === clientTxId ? { ...item, state: "acked", ackedSyncId: syncId } : item,
    );
    this.publish();
  }

  remove(clientTxIds: Iterable<string>): string[] {
    const ids = new Set(clientTxIds);
    const removed: string[] = [];
    this.items = this.items.filter((item) => {
      if (!ids.has(item.tx.clientTxId)) return true;
      removed.push(item.tx.clientTxId);
      return false;
    });
    if (removed.length > 0) this.publish();
    return removed;
  }

  /** Drops accepted transactions whose effect is already part of confirmed state. */
  dropAckedThrough(lastSyncId: number): string[] {
    const settled = this.items.filter((item) => item.ackedSyncId !== null && item.ackedSyncId <= lastSyncId);
    return this.remove(settled.map((item) => item.tx.clientTxId));
  }

  private publish(): void {
    this.snapshot = Object.freeze([...this.items]);
  }
}
