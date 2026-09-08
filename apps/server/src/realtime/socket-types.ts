import type {
  CatchUpResponse,
  PresenceUpdate,
  PushResponse,
  ResyncNotice,
  SocketAck,
  SyncDelta,
  socketEvents,
} from "@tracklane/domain";
import type { Server, Socket } from "socket.io";
import type { AccessContext } from "../services/access.service.js";

export interface ServerToClientEvents {
  [socketEvents.delta]: (delta: SyncDelta) => void;
  [socketEvents.resync]: (notice: ResyncNotice) => void;
  [socketEvents.presenceUpdate]: (update: PresenceUpdate) => void;
}

export interface ClientToServerEvents {
  [socketEvents.push]: (payload: unknown, ack: (response: SocketAck<PushResponse>) => void) => void;
  [socketEvents.catchUp]: (payload: unknown, ack: (response: SocketAck<CatchUpResponse>) => void) => void;
  [socketEvents.presenceView]: (payload: unknown) => void;
  [socketEvents.presenceHeartbeat]: () => void;
}

export interface SocketData {
  token: string;
  context: AccessContext;
  expiresAt: number;
  viewing: Map<string, { teamId: string; viewers: string[] }>;
}

export type SyncServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
export type SyncSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export const teamRoom = (workspaceId: string, teamId: string): string => `ws:${workspaceId}:team:${teamId}`;
