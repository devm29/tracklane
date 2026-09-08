import type { PresenceUpdate, SyncDelta, Transaction, TxResult } from "@tracklane/domain";

export interface TabChannel<T> {
  post(message: T): void;
  subscribe(handler: (message: T) => void): () => void;
  close(): void;
}

export class BroadcastTabChannel<T> implements TabChannel<T> {
  private readonly channel: BroadcastChannel;
  private closed = false;

  constructor(name: string) {
    this.channel = new BroadcastChannel(name);
  }

  post(message: T): void {
    // Persistence callbacks can finish after the client shut down; dropping the message is correct then.
    if (!this.closed) this.channel.postMessage(message);
  }

  subscribe(handler: (message: T) => void): () => void {
    const listener = (event: MessageEvent<T>): void => handler(event.data);
    this.channel.addEventListener("message", listener);
    return () => this.channel.removeEventListener("message", listener);
  }

  close(): void {
    this.closed = true;
    this.channel.close();
  }
}

/** In-process stand-in for BroadcastChannel: async delivery to every other member, never to the sender. */
export class MemoryTabHub<T> {
  private readonly members = new Set<Set<(message: T) => void>>();

  channel(): TabChannel<T> {
    const handlers = new Set<(message: T) => void>();
    this.members.add(handlers);
    return {
      post: (message) => {
        const copy = structuredClone(message);
        for (const member of this.members) {
          if (member === handlers) continue;
          setTimeout(() => member.forEach((handler) => handler(copy)), 0);
        }
      },
      subscribe: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      close: () => {
        this.members.delete(handlers);
      },
    };
  }
}

export type ConnectionState = "offline" | "connecting" | "syncing" | "live";

export type TabMessage =
  | { type: "hello" }
  | { type: "tx"; tx: Transaction }
  | { type: "deltas"; deltas: SyncDelta[]; lastSyncId: number }
  | { type: "results"; results: TxResult[] }
  | { type: "snapshot"; lastSyncId: number }
  | { type: "status"; connection: ConnectionState; networkEnabled: boolean; latencyMs: number }
  | { type: "control"; networkEnabled?: boolean; latencyMs?: number }
  | { type: "leader" }
  | { type: "viewing"; tabId: string; issueId: string | null }
  | { type: "presence"; update: PresenceUpdate };
