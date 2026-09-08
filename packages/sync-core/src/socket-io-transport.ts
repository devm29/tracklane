import {
  BootstrapPayload,
  CatchUpResponse,
  PresenceUpdate,
  PushResponse,
  ResyncNotice,
  SyncDelta,
  type Transaction,
  type TxResult,
  socketAck,
  socketEvents,
} from "@tracklane/domain";
import { type Socket, io } from "socket.io-client";
import type { z } from "zod";
import type { SyncTransport, TransportListener } from "./transport.js";

export interface SocketIoTransportOptions {
  /** API origin, e.g. http://localhost:8110. */
  url: string;
  getToken: () => string | null;
  requestTimeoutMs?: number;
  presenceHeartbeatMs?: number;
  fetch?: typeof fetch;
  onAuthError?: () => void;
}

export class TransportError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

const PushAck = socketAck(PushResponse);
const CatchUpAck = socketAck(CatchUpResponse);

/**
 * Socket.IO for the sync channel, fetch for the bootstrap snapshot (it can be
 * megabytes and benefits from HTTP compression and caching layers).
 */
export class SocketIoTransport implements SyncTransport {
  private socket: Socket | null = null;
  private presence: readonly string[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private readonly requestTimeoutMs: number;
  private readonly presenceHeartbeatMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: SocketIoTransportOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.presenceHeartbeatMs = options.presenceHeartbeatMs ?? 10_000;
    this.fetchImpl = options.fetch ?? ((...args) => fetch(...args));
  }

  connect(listener: TransportListener): void {
    this.disconnect();
    const socket = io(this.options.url, {
      auth: (callback) => callback({ token: this.options.getToken() ?? "" }),
      transports: ["websocket"],
      reconnectionDelay: 500,
      reconnectionDelayMax: 5_000,
    });
    this.socket = socket;
    socket.on("connect", () => {
      this.sendPresence();
      listener.onConnect();
    });
    socket.on("disconnect", (reason) => listener.onDisconnect(reason));
    socket.on("connect_error", (error) => {
      if (error.message === "unauthorized") this.options.onAuthError?.();
    });
    socket.on(socketEvents.delta, (raw: unknown) => {
      const parsed = SyncDelta.safeParse(raw);
      if (parsed.success) listener.onDelta(parsed.data);
    });
    socket.on(socketEvents.resync, (raw: unknown) => {
      if (ResyncNotice.safeParse(raw).success) listener.onResync();
    });
    socket.on(socketEvents.presenceUpdate, (raw: unknown) => {
      const parsed = PresenceUpdate.safeParse(raw);
      if (parsed.success) listener.onPresence(parsed.data);
    });
    this.heartbeat = setInterval(() => {
      if (this.presence.length > 0) socket.emit(socketEvents.presenceHeartbeat);
    }, this.presenceHeartbeatMs);
  }

  disconnect(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = null;
  }

  setPresence(issueIds: readonly string[]): void {
    this.presence = [...issueIds];
    this.sendPresence();
  }

  async bootstrap(): Promise<BootstrapPayload> {
    const response = await this.fetchImpl(`${this.options.url}/api/sync/bootstrap`, {
      headers: { authorization: `Bearer ${this.options.getToken() ?? ""}` },
      cache: "no-store",
    });
    if (response.status === 401) {
      this.options.onAuthError?.();
      throw new TransportError("unauthorized", "Session expired");
    }
    if (!response.ok) throw new TransportError("http", `Bootstrap failed with ${response.status}`);
    return BootstrapPayload.parse(await response.json());
  }

  async catchUp(lastSyncId: number, epoch: string): Promise<CatchUpResponse> {
    return this.request(socketEvents.catchUp, { lastSyncId, epoch }, CatchUpAck);
  }

  async push(txs: readonly Transaction[]): Promise<TxResult[]> {
    const response = await this.request(socketEvents.push, { txs }, PushAck);
    return response.results;
  }

  private sendPresence(): void {
    if (this.socket?.connected) this.socket.emit(socketEvents.presenceView, { issueIds: this.presence });
  }

  private async request<T>(
    event: string,
    payload: unknown,
    schema: z.ZodType<{ ok: true; data: T } | { ok: false; error: { code: string; message: string } }>,
  ): Promise<T> {
    const socket = this.socket;
    if (!socket?.connected) throw new TransportError("offline", "Not connected");
    const raw: unknown = await socket.timeout(this.requestTimeoutMs).emitWithAck(event, payload);
    const ack = schema.parse(raw);
    if (!ack.ok) throw new TransportError(ack.error.code, ack.error.message);
    return ack.data;
  }
}
