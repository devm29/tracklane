import type { BootstrapPayload, CatchUpResponse, Transaction, TxResult } from "@tracklane/domain";
import type { SyncTransport, TransportListener } from "../transport.js";
import type { InMemorySyncServer } from "./in-memory-server.js";

export class NetworkError extends Error {
  constructor() {
    super("Network unavailable");
    this.name = "NetworkError";
  }
}

interface PendingRequest {
  run: () => unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface PendingResponse {
  deliver: () => void;
  fail: () => void;
}

/**
 * A transport whose every hop is a queued step. In "manual" mode a test (or a
 * fast-check scheduler) decides when requests reach the server, when responses
 * come back and when pushed deltas arrive, which is how the convergence
 * property explores interleavings. In "auto" mode each hop runs on the next
 * macrotask, which behaves like a fast, reliable network.
 */
export class ScriptedTransport implements SyncTransport {
  private listener: TransportListener | null = null;
  private linkUp = true;
  private connected = false;
  private unsubscribe: (() => void) | null = null;
  private readonly requests: PendingRequest[] = [];
  private readonly responses: PendingResponse[] = [];
  private readonly inbound: (() => void)[] = [];

  constructor(
    private readonly server: InMemorySyncServer,
    private readonly userId: string,
    private readonly mode: "manual" | "auto" = "manual",
  ) {}

  get pendingRequests(): number {
    return this.requests.length;
  }

  get pendingResponses(): number {
    return this.responses.length;
  }

  get pendingInbound(): number {
    return this.inbound.length;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  connect(listener: TransportListener): void {
    this.listener = listener;
    if (this.linkUp) this.establish();
  }

  disconnect(): void {
    this.listener = null;
    this.teardown();
  }

  /** Simulates the link dropping: in-flight work is lost and the client is told it disconnected. */
  dropLink(): void {
    if (!this.linkUp) return;
    this.linkUp = false;
    const wasConnected = this.connected;
    this.teardown();
    if (wasConnected) this.listener?.onDisconnect("transport close");
  }

  restoreLink(): void {
    if (this.linkUp) return;
    this.linkUp = true;
    if (this.listener) this.establish();
  }

  bootstrap(): Promise<BootstrapPayload> {
    return this.request(() => this.server.bootstrap(this.userId));
  }

  catchUp(lastSyncId: number, epoch: string): Promise<CatchUpResponse> {
    return this.request(() => this.server.catchUp(this.userId, lastSyncId, epoch));
  }

  push(txs: readonly Transaction[]): Promise<TxResult[]> {
    const copy = structuredClone([...txs]);
    return this.request(() => this.server.push(this.userId, copy));
  }

  deliverRequest(): boolean {
    const request = this.requests.shift();
    if (!request) return false;
    const value = request.run();
    this.responses.push({ deliver: () => request.resolve(value), fail: () => request.reject(new NetworkError()) });
    this.schedule(() => this.deliverResponse());
    return true;
  }

  deliverResponse(): boolean {
    const response = this.responses.shift();
    if (!response) return false;
    response.deliver();
    return true;
  }

  deliverInbound(): boolean {
    const event = this.inbound.shift();
    if (!event) return false;
    event();
    return true;
  }

  private establish(): void {
    if (this.connected) return;
    this.connected = true;
    this.unsubscribe = this.server.subscribe(this.userId, {
      delta: (delta) => this.enqueueInbound(() => this.listener?.onDelta(delta)),
      resync: () => this.enqueueInbound(() => this.listener?.onResync()),
    });
    this.enqueueInbound(() => this.listener?.onConnect());
  }

  private teardown(): void {
    this.connected = false;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.inbound.length = 0;
    for (const request of this.requests.splice(0)) request.reject(new NetworkError());
    for (const response of this.responses.splice(0)) response.fail();
  }

  private request<T>(run: () => T): Promise<T> {
    if (!this.connected) return Promise.reject(new NetworkError());
    return new Promise<T>((resolve, reject) => {
      this.requests.push({ run, resolve: resolve as (value: unknown) => void, reject });
      this.schedule(() => this.deliverRequest());
    });
  }

  private enqueueInbound(event: () => void): void {
    this.inbound.push(event);
    this.schedule(() => this.deliverInbound());
  }

  private schedule(step: () => void): void {
    if (this.mode === "auto") setTimeout(step, 0);
  }
}
