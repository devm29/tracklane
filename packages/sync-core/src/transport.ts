import type { BootstrapPayload, CatchUpResponse, PresenceUpdate, SyncDelta, Transaction, TxResult } from "@tracklane/domain";

export interface TransportListener {
  onConnect(): void;
  onDisconnect(reason: string): void;
  onDelta(delta: SyncDelta): void;
  onPresence(update: PresenceUpdate): void;
  /** The server changed what this client may see; the replica has to be rebuilt from a fresh bootstrap. */
  onResync(): void;
}

/**
 * What the engine needs from the network. The web app implements it with
 * Socket.IO plus fetch; tests implement it with an in-memory server.
 *
 * `connect` keeps reconnecting on its own until `disconnect` is called.
 */
export interface SyncTransport {
  connect(listener: TransportListener): void;
  disconnect(): void;
  bootstrap(): Promise<BootstrapPayload>;
  catchUp(lastSyncId: number, epoch: string): Promise<CatchUpResponse>;
  push(txs: readonly Transaction[]): Promise<TxResult[]>;
  /** Issues this client is looking at; the transport keeps the server informed across reconnects. */
  setPresence?(issueIds: readonly string[]): void;
  setSimulatedLatency?(ms: number): void;
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * Adds one-way latency to every request, response and server push while
 * preserving delivery order. Used by the dev-tools panel to make optimistic
 * updates and rebasing visible.
 */
export class SimulatedNetworkTransport implements SyncTransport {
  private latencyMs = 0;
  private generation = 0;
  private lastDeliveryAt = 0;

  constructor(private readonly inner: SyncTransport) {}

  setSimulatedLatency(ms: number): void {
    this.latencyMs = Math.max(0, Math.round(ms));
  }

  connect(listener: TransportListener): void {
    const generation = ++this.generation;
    const deliver = (fn: () => void): void => {
      const at = Math.max(Date.now() + this.latencyMs, this.lastDeliveryAt);
      this.lastDeliveryAt = at;
      const run = (): void => {
        if (generation === this.generation) fn();
      };
      if (at <= Date.now()) run();
      else setTimeout(run, at - Date.now());
    };
    this.inner.connect({
      onConnect: () => deliver(() => listener.onConnect()),
      onDisconnect: (reason) => deliver(() => listener.onDisconnect(reason)),
      onDelta: (delta) => deliver(() => listener.onDelta(delta)),
      onPresence: (update) => deliver(() => listener.onPresence(update)),
      onResync: () => deliver(() => listener.onResync()),
    });
  }

  disconnect(): void {
    this.generation += 1;
    this.inner.disconnect();
  }

  setPresence(issueIds: readonly string[]): void {
    this.inner.setPresence?.(issueIds);
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.roundTrip(() => this.inner.bootstrap());
  }

  catchUp(lastSyncId: number, epoch: string): Promise<CatchUpResponse> {
    return this.roundTrip(() => this.inner.catchUp(lastSyncId, epoch));
  }

  push(txs: readonly Transaction[]): Promise<TxResult[]> {
    return this.roundTrip(() => this.inner.push(txs));
  }

  private async roundTrip<T>(request: () => Promise<T>): Promise<T> {
    await sleep(this.latencyMs);
    const response = await request();
    await sleep(this.latencyMs);
    return response;
  }
}
