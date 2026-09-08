import {
  type BootstrapPayload,
  type CommentCreateInput,
  type IssueCreateInput,
  type IssuePatch,
  Mutation,
  type MutationActor,
  type RejectionCode,
  type SyncDelta,
  type Transaction,
  type TxResult,
} from "@tracklane/domain";
import { Backoff, RetryTimer } from "./backoff.js";
import type { LocalStore } from "./local-store.js";
import { type EntityRecord, ObjectPool } from "./object-pool.js";
import { PresenceCoordinator } from "./presence-coordinator.js";
import { rebase, tryApply } from "./rebaser.js";
import { TabCoordinator, type TabSetup } from "./tab-coordinator.js";
import type { ConnectionState, TabMessage } from "./tabs.js";
import { type PendingTransaction, TransactionQueue } from "./transaction-queue.js";
import type { SyncTransport, TransportListener } from "./transport.js";

export type TabRole = "leader" | "follower";

export interface SyncStatus {
  readonly role: TabRole;
  readonly connection: ConnectionState;
  readonly networkEnabled: boolean;
  readonly latencyMs: number;
  readonly lastSyncId: number;
  readonly bootstrapped: boolean;
  readonly pending: readonly PendingTransaction[];
  readonly lastError: string | null;
}

export type SyncEvent =
  | { type: "rejected"; tx: Transaction; code: RejectionCode; message: string; local: boolean }
  | { type: "rebootstrapped"; lastSyncId: number }
  | { type: "deltas"; deltas: readonly SyncDelta[] }
  | { type: "error"; message: string };

export interface SyncClientOptions {
  actor: MutationActor;
  store: LocalStore;
  transport: SyncTransport;
  /** Omit for a single-tab client that always leads. */
  tabs?: TabSetup;
  batchSize?: number;
  /** First retry delay; later ones back off exponentially with jitter up to `maxRetryDelayMs`. */
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  presenceHeartbeatMs?: number;
  now?: () => string;
  newId?: () => string;
}

export class MutationRejectedError extends Error {
  constructor(readonly code: RejectionCode, message: string) {
    super(message);
    this.name = "MutationRejectedError";
  }
}

export function bootstrapRecords(payload: BootstrapPayload): EntityRecord[] {
  return [
    ...payload.users.map((data): EntityRecord => ({ model: "user", data })),
    ...payload.teams.map((data): EntityRecord => ({ model: "team", data })),
    ...payload.projects.map((data): EntityRecord => ({ model: "project", data })),
    ...payload.labels.map((data): EntityRecord => ({ model: "label", data })),
    ...payload.issues.map((data): EntityRecord => ({ model: "issue", data })),
    ...payload.comments.map((data): EntityRecord => ({ model: "comment", data })),
  ];
}

const SETTLED_MEMORY = 5_000;

/**
 * Local-first replica of one workspace.
 *
 * Reads come from the in-memory ObjectPool. Writes are applied optimistically,
 * persisted to the outbox and pushed by the leader tab. Server deltas update
 * confirmed state; pending transactions are then rebased on top of it.
 * Followers never touch the network: they mirror the leader over the tab
 * channel and hand their own transactions to it through the shared outbox.
 *
 * Election and channel plumbing live in TabCoordinator and presence in
 * PresenceCoordinator; this class owns the replica, the queue and the
 * transport lifecycle.
 */
export class SyncClient {
  readonly pool = new ObjectPool();
  private readonly queue = new TransactionQueue();
  private readonly options: SyncClientOptions & Required<Pick<SyncClientOptions, "batchSize" | "now" | "newId">>;
  private readonly tabs: TabCoordinator;
  private readonly presence: PresenceCoordinator;
  private readonly syncRetry: RetryTimer;
  private readonly pushRetry: RetryTimer;
  private role: TabRole = "follower";
  private connection: ConnectionState = "offline";
  private networkEnabled = true;
  private latencyMs = 0;
  private lastSyncId = 0;
  private epoch: string | null = null;
  private bootstrapped = false;
  private lastError: string | null = null;
  private loaded = false;
  private stopped = false;
  private connectGeneration = 0;
  private session = 0;
  private catchingUp = true;
  private bufferedDeltas: SyncDelta[] = [];
  private flushing = false;
  /** Transactions created in this tab and not yet settled; rejections of these are shown to the user. */
  private readonly localTxIds = new Set<string>();
  private readonly settledTxIds = new Set<string>();
  private persistChain: Promise<void> = Promise.resolve();
  private status: SyncStatus;
  private readonly statusListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: SyncEvent) => void>();

  constructor(options: SyncClientOptions) {
    this.options = {
      batchSize: 50,
      now: () => new Date().toISOString(),
      newId: () => crypto.randomUUID(),
      ...options,
    };
    const backoff = (): Backoff =>
      new Backoff({ baseMs: options.retryDelayMs ?? 1_000, maxMs: options.maxRetryDelayMs ?? 30_000 });
    this.syncRetry = new RetryTimer(backoff());
    this.pushRetry = new RetryTimer(backoff());
    this.tabs = new TabCoordinator(options.tabs, {
      onRoleChange: (isLeader) => (isLeader ? this.becomeLeader() : this.becomeFollower()),
      onMessage: (message) => this.handleTabMessage(message),
      onError: (error) => this.fail(error),
    });
    this.presence = new PresenceCoordinator({
      tabId: this.options.newId(),
      isLeader: () => this.role === "leader",
      post: (message) => this.tabs.post(message),
      report: (issueIds) => this.options.transport.setPresence?.(issueIds),
      ...(options.presenceHeartbeatMs ? { heartbeatMs: options.presenceHeartbeatMs } : {}),
    });
    this.status = this.buildStatus();
  }

  get actor(): MutationActor {
    return this.options.actor;
  }

  async start(): Promise<void> {
    const loading = this.loadFromStore();
    // Messages that arrive while the replica loads must apply on top of it, not underneath.
    this.tabs.listen(loading);
    await loading;
    this.loaded = true;
    // stop() may have run while the store was loading (React strict mode does exactly this).
    if (this.stopped) return;
    this.presence.start();
    if (this.tabs.shared) this.tabs.elect();
    else await this.becomeLeader();
  }

  async stop(): Promise<void> {
    this.presence.stop();
    this.stopped = true;
    this.session += 1;
    this.syncRetry.cancel();
    this.pushRetry.cancel();
    this.tabs.stop();
    this.connectGeneration += 1;
    this.options.transport.disconnect();
    await this.whenIdle();
  }

  /**
   * Stops syncing and removes this workspace from the device. With
   * `keepOutbox`, unsent changes survive so they can still go out after the
   * same person signs back in.
   */
  async wipe(options: { keepOutbox?: boolean } = {}): Promise<void> {
    await this.stop();
    if (options.keepOutbox) await this.options.store.clearReplica();
    else await this.options.store.clear();
    this.options.store.close();
  }

  /** Resolves once queued persistence and tab-message handling have drained. */
  async whenIdle(): Promise<void> {
    await this.tabs.idle();
    await this.persistChain;
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  onEvent(listener: (event: SyncEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /**
   * Applies a change optimistically and queues it for the server. Throws
   * MutationRejectedError when the change is invalid or not allowed right now;
   * returns null when it would change nothing, in which case nothing is sent.
   */
  mutate(input: Mutation): Transaction | null {
    const parsed = Mutation.safeParse(input);
    if (!parsed.success) {
      throw new MutationRejectedError("validation", parsed.error.issues[0]?.message ?? "That change isn't valid");
    }
    const tx: Transaction = { clientTxId: this.options.newId(), mutation: parsed.data, createdAt: this.options.now() };
    const check = tryApply(this.pool, tx, { actor: this.actor });
    if (!check.ok) throw new MutationRejectedError(check.rejection.code, check.rejection.message);
    if (!check.write) return null;

    this.queue.enqueue(tx);
    this.localTxIds.add(tx.clientTxId);
    this.rebaseAndCommit();
    this.persist(async () => {
      await this.options.store.putTransaction(tx);
      if (this.role === "leader") void this.flush();
      else this.tabs.post({ type: "tx", tx });
    });
    return tx;
  }

  createIssue(input: IssueCreateInput): string {
    const id = this.options.newId();
    this.mutate({ kind: "issue.create", id, input });
    return id;
  }

  updateIssue(id: string, patch: IssuePatch): void {
    this.mutate({ kind: "issue.update", id, patch });
  }

  archiveIssue(id: string): void {
    this.mutate({ kind: "issue.archive", id });
  }

  unarchiveIssue(id: string): void {
    this.mutate({ kind: "issue.unarchive", id });
  }

  addComment(input: CommentCreateInput): string {
    const id = this.options.newId();
    this.mutate({ kind: "comment.create", id, input });
    return id;
  }

  deleteComment(id: string): void {
    this.mutate({ kind: "comment.delete", id });
  }

  /** Declares which issue this tab is showing; the leader aggregates all tabs and reports them to the server. */
  setViewing(issueId: string | null): void {
    this.presence.setViewing(issueId);
  }

  getViewers(issueId: string): readonly string[] {
    return this.presence.getViewers(issueId);
  }

  subscribePresence(listener: () => void): () => void {
    return this.presence.subscribe(listener);
  }

  setNetworkEnabled(enabled: boolean): void {
    if (this.role === "follower") {
      this.tabs.post({ type: "control", networkEnabled: enabled });
      return;
    }
    if (this.networkEnabled === enabled) return;
    this.networkEnabled = enabled;
    if (enabled) this.connect();
    else this.disconnect("offline");
    this.emitStatus();
  }

  setSimulatedLatency(ms: number): void {
    if (this.role === "follower") {
      this.tabs.post({ type: "control", latencyMs: ms });
      return;
    }
    this.latencyMs = Math.max(0, ms);
    this.options.transport.setSimulatedLatency?.(this.latencyMs);
    this.emitStatus();
  }

  /**
   * Reloads the replica from the shared store. Our own writes may still be on
   * their way there, so wait for them, and keep any queued transaction the
   * store doesn't have yet rather than dropping it.
   */
  private async loadFromStore(): Promise<void> {
    await this.persistChain;
    const state = await this.options.store.load();
    if (state) {
      this.pool.replaceConfirmed(state.records);
      this.lastSyncId = state.lastSyncId;
      this.epoch = state.epoch;
      this.bootstrapped = true;
    }
    const outbox = state ? state.outbox : await this.options.store.loadOutbox();
    this.queue.reconcile(outbox, (clientTxId) => !this.settledTxIds.has(clientTxId));
    this.rebaseAndCommit();
  }

  private async becomeLeader(): Promise<void> {
    if (this.stopped || this.role === "leader") return;
    this.role = "leader";
    // A previous leader may have persisted state or accepted follower
    // transactions this tab never heard about, so the store is the source of truth.
    if (this.loaded && this.tabs.shared) await this.loadFromStore();
    this.options.transport.setSimulatedLatency?.(this.latencyMs);
    this.presence.becameLeader();
    this.tabs.post({ type: "leader" });
    if (this.networkEnabled) this.connect();
    this.emitStatus();
  }

  private becomeFollower(): void {
    if (this.role === "follower") return;
    this.role = "follower";
    this.disconnect("connecting");
  }

  private connect(): void {
    const generation = ++this.connectGeneration;
    this.connection = "connecting";
    this.catchingUp = true;
    this.bufferedDeltas = [];
    const current = (): boolean => generation === this.connectGeneration && !this.stopped;
    const listener: TransportListener = {
      onConnect: () => {
        if (current()) void this.synchronize(++this.session);
      },
      onDisconnect: () => {
        if (!current()) return;
        this.session += 1;
        this.syncRetry.cancel();
        this.pushRetry.cancel();
        this.connection = "connecting";
        this.catchingUp = true;
        this.bufferedDeltas = [];
        this.queue.requeueInflight();
        this.broadcastStatus();
      },
      onDelta: (delta) => {
        if (!current()) return;
        if (this.catchingUp) this.bufferedDeltas.push(delta);
        else this.applyDeltas([delta]);
      },
      onPresence: (update) => {
        if (!current()) return;
        this.presence.apply(update);
        this.tabs.post({ type: "presence", update });
      },
      onResync: () => {
        if (current()) void this.synchronize(++this.session, { rebootstrap: true });
      },
    };
    this.options.transport.connect(listener);
    this.broadcastStatus();
  }

  private disconnect(state: ConnectionState): void {
    this.connectGeneration += 1;
    this.session += 1;
    this.syncRetry.cancel();
    this.pushRetry.cancel();
    this.options.transport.disconnect();
    this.connection = state;
    this.catchingUp = true;
    this.bufferedDeltas = [];
    this.queue.requeueInflight();
    this.broadcastStatus();
  }

  /** Bootstrap or delta catch-up after (re)connecting, then drain the outbox. */
  private async synchronize(session: number, options: { rebootstrap?: boolean } = {}): Promise<void> {
    const current = (): boolean => session === this.session && !this.stopped;
    this.connection = "syncing";
    this.catchingUp = true;
    this.broadcastStatus();
    try {
      if (!this.bootstrapped || this.epoch === null || options.rebootstrap) {
        await this.bootstrap(current);
      } else {
        const response = await this.options.transport.catchUp(this.lastSyncId, this.epoch);
        if (!current()) return;
        if (response.kind === "rebootstrap") await this.bootstrap(current);
        else this.applyDeltas(response.deltas, response.lastSyncId);
      }
      if (!current()) return;
      const buffered = this.bufferedDeltas;
      this.bufferedDeltas = [];
      this.catchingUp = false;
      this.applyDeltas(buffered);
      this.connection = "live";
      this.lastError = null;
      this.syncRetry.succeeded();
      this.broadcastStatus();
      void this.flush();
    } catch (error) {
      if (!current()) return;
      this.fail(error);
      this.syncRetry.schedule(() => {
        if (current()) void this.synchronize(session, options);
      });
    }
  }

  private async bootstrap(current: () => boolean): Promise<void> {
    const payload = await this.options.transport.bootstrap();
    if (!current()) return;
    const records = bootstrapRecords(payload);
    const cursor = { lastSyncId: payload.lastSyncId, epoch: payload.epoch };
    this.pool.replaceConfirmed(records);
    this.lastSyncId = payload.lastSyncId;
    this.epoch = payload.epoch;
    this.bootstrapped = true;
    this.queue.dropAckedThrough(this.lastSyncId);
    this.rebaseAndCommit();
    this.persist(async () => {
      await this.options.store.replaceSnapshot(records, cursor);
      this.tabs.post({ type: "snapshot", lastSyncId: cursor.lastSyncId });
    });
    this.emit({ type: "rebootstrapped", lastSyncId: payload.lastSyncId });
  }

  /**
   * Applies server deltas in syncId order. `watermark` is the server's own
   * position: every syncId up to it is committed, so the cursor can move there
   * even when the deltas in between belong to teams this user can't see.
   */
  private applyDeltas(incoming: readonly SyncDelta[], watermark = 0): void {
    const fresh = incoming.filter((delta) => delta.syncId > this.lastSyncId).sort((a, b) => a.syncId - b.syncId);
    const target = Math.max(this.lastSyncId, watermark, fresh.at(-1)?.syncId ?? 0);
    if (target === this.lastSyncId) return;

    const settled: string[] = [];
    let applied = this.lastSyncId;
    for (const delta of fresh) {
      if (delta.syncId <= applied) continue;
      applied = delta.syncId;
      if (delta.action === "remove") this.pool.removeConfirmed(delta.model, delta.modelId);
      else if (delta.model === "issue") this.pool.upsertConfirmed({ model: "issue", data: delta.data });
      else this.pool.upsertConfirmed({ model: "comment", data: delta.data });
      if (delta.clientTxId) settled.push(delta.clientTxId);
    }
    this.lastSyncId = target;
    this.markSettled(settled);
    const removed = [...this.queue.remove(settled), ...this.queue.dropAckedThrough(target)];
    this.rebaseAndCommit();
    if (fresh.length > 0) this.emit({ type: "deltas", deltas: fresh });

    if (this.role === "leader") {
      this.persist(async () => {
        await this.options.store.applyDeltas(fresh, target);
        await this.options.store.deleteTransactions(removed);
        this.tabs.post({ type: "deltas", deltas: fresh, lastSyncId: target });
      });
    }
  }

  private handleResults(results: readonly TxResult[]): void {
    const removed: string[] = [];
    const pending = new Map(this.queue.list().map((item) => [item.tx.clientTxId, item.tx]));
    for (const result of results) {
      const tx = pending.get(result.clientTxId);
      if (!tx) continue;
      if (result.status === "rejected") {
        removed.push(...this.queue.remove([result.clientTxId]));
        this.emit({
          type: "rejected",
          tx,
          code: result.code,
          message: result.message,
          local: this.localTxIds.has(result.clientTxId),
        });
      } else if (result.status === "noop" || result.syncId <= this.lastSyncId) {
        removed.push(...this.queue.remove([result.clientTxId]));
      } else {
        this.queue.markAcked(result.clientTxId, result.syncId);
      }
    }
    this.markSettled(results.map((result) => result.clientTxId));
    this.rebaseAndCommit();
    if (this.role === "leader") {
      this.persist(async () => {
        await this.options.store.deleteTransactions(removed);
        this.tabs.post({ type: "results", results: [...results] });
      });
    }
  }

  private canPush(): boolean {
    return this.connection === "live" && this.role === "leader" && !this.stopped;
  }

  private async flush(): Promise<void> {
    if (this.flushing || !this.canPush() || this.pushRetry.pending) return;
    this.flushing = true;
    let retry = false;
    try {
      while (this.canPush()) {
        const session = this.session;
        const batch = this.queue.takeBatch(this.options.batchSize);
        if (batch.length === 0) break;
        this.emitStatus();
        let results: TxResult[];
        try {
          results = await this.options.transport.push(batch);
        } catch (error) {
          this.queue.requeueInflight(new Set(batch.map((tx) => tx.clientTxId)));
          // A failure caused by a dropped connection is retried by the next session's flush.
          if (session === this.session) {
            this.fail(error);
            retry = true;
          }
          break;
        }
        this.pushRetry.succeeded();
        this.handleResults(results);
      }
    } finally {
      this.flushing = false;
      this.emitStatus();
    }
    if (retry) {
      this.pushRetry.schedule(() => void this.flush());
    } else if (this.canPush() && this.queue.hasQueued()) {
      void this.flush();
    }
  }

  private async handleTabMessage(message: TabMessage): Promise<void> {
    if (this.stopped) return;
    switch (message.type) {
      case "hello":
        if (this.role === "leader") this.broadcastStatus();
        return;
      case "tx":
        // Another tab's transaction can be confirmed by the leader before its own announcement reaches us.
        if (!this.settledTxIds.has(message.tx.clientTxId) && this.queue.enqueue(message.tx)) {
          this.rebaseAndCommit();
          if (this.role === "leader") void this.flush();
        }
        return;
      case "deltas":
        if (this.role === "follower") this.applyDeltas(message.deltas, message.lastSyncId);
        return;
      case "results":
        if (this.role === "follower") this.handleResults(message.results);
        return;
      case "snapshot":
        if (this.role === "follower") await this.loadFromStore();
        return;
      case "status":
        if (this.role === "follower") {
          this.connection = message.connection;
          this.networkEnabled = message.networkEnabled;
          this.latencyMs = message.latencyMs;
          this.emitStatus();
        }
        return;
      case "leader":
        this.presence.leaderChanged();
        return;
      case "viewing":
        this.presence.receive(message.tabId, message.issueId);
        return;
      case "presence":
        if (this.role === "follower") this.presence.apply(message.update);
        return;
      case "control":
        if (this.role !== "leader") return;
        if (message.latencyMs !== undefined) this.setSimulatedLatency(message.latencyMs);
        if (message.networkEnabled !== undefined) this.setNetworkEnabled(message.networkEnabled);
        return;
    }
  }

  private rebaseAndCommit(): void {
    const { overlay } = rebase(this.pool.confirmedReader, this.queue.transactions(), { actor: this.actor });
    this.pool.setOverlay(overlay);
    this.pool.commit();
    this.emitStatus();
  }

  private markSettled(ids: readonly string[]): void {
    for (const id of ids) {
      this.settledTxIds.add(id);
      this.localTxIds.delete(id);
    }
    const overflow = this.settledTxIds.size - SETTLED_MEMORY;
    if (overflow <= 0) return;
    let dropped = 0;
    for (const id of this.settledTxIds) {
      if (dropped++ >= overflow) break;
      this.settledTxIds.delete(id);
    }
  }

  private persist(operation: () => Promise<void>): void {
    this.persistChain = this.persistChain.then(operation).catch((error: unknown) => this.fail(error));
  }

  private fail(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.lastError = message;
    this.emit({ type: "error", message });
    this.emitStatus();
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private broadcastStatus(): void {
    this.emitStatus();
    if (this.role !== "leader") return;
    this.tabs.post({
      type: "status",
      connection: this.connection,
      networkEnabled: this.networkEnabled,
      latencyMs: this.latencyMs,
    });
  }

  private emitStatus(): void {
    const next = this.buildStatus();
    const previous = this.status;
    if (
      previous.role === next.role &&
      previous.connection === next.connection &&
      previous.networkEnabled === next.networkEnabled &&
      previous.latencyMs === next.latencyMs &&
      previous.lastSyncId === next.lastSyncId &&
      previous.bootstrapped === next.bootstrapped &&
      previous.pending === next.pending &&
      previous.lastError === next.lastError
    ) {
      return;
    }
    this.status = next;
    for (const listener of this.statusListeners) listener();
  }

  private buildStatus(): SyncStatus {
    return {
      role: this.role,
      connection: this.connection,
      networkEnabled: this.networkEnabled,
      latencyMs: this.latencyMs,
      lastSyncId: this.lastSyncId,
      bootstrapped: this.bootstrapped,
      pending: this.queue.list(),
      lastError: this.lastError,
    };
  }
}
