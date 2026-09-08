import {
  CatchUpRequest,
  PresenceViewRequest,
  PushRequest,
  type SocketAck,
  Transaction,
  type TxResult,
  socketEvents,
} from "@tracklane/domain";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { WorkspaceRepository } from "../repositories/workspace.repository.js";
import type { AccessContext, AccessService } from "../services/access.service.js";
import type { AuthService } from "../services/auth.service.js";
import type { CatchUpService } from "../services/catch-up.service.js";
import type { MutationService } from "../services/mutation.service.js";
import type { PresenceStore } from "../services/presence.service.js";
import { TokenBucket } from "../services/rate-limiter.js";
import { type SyncServer, type SyncSocket, teamRoom } from "./socket-types.js";

export interface SocketGatewayDeps {
  auth: AuthService;
  access: AccessService;
  mutations: MutationService;
  catchUp: CatchUpService;
  presence: PresenceStore;
  workspaces: WorkspaceRepository;
  presenceTtlMs: number;
  /** How often a connected socket's team membership is re-read. */
  accessRefreshMs: number;
  logger: Logger;
}

const HandshakeAuth = z.object({ token: z.string().min(1) });
// setTimeout overflows above this and fires immediately.
const MAX_TIMER_MS = 2 ** 31 - 1;

const rateLimited = (): SocketAck<never> => ({
  ok: false,
  error: { code: "rate_limited", message: "Too many requests; slow down" },
});

function failure(error: unknown): SocketAck<never> {
  if (error instanceof AppError) return { ok: false, error: { code: error.code, message: error.message } };
  if (error instanceof z.ZodError) return { ok: false, error: { code: "bad_request", message: "Malformed payload" } };
  return { ok: false, error: { code: "internal", message: "Something went wrong on our side" } };
}

/**
 * Parses each transaction on its own: a malformed entry is rejected by id
 * instead of failing the batch, otherwise one bad outbox entry would block
 * every write queued behind it forever.
 */
function parseTransactions(raw: readonly unknown[]): { valid: Transaction[]; invalid: TxResult[] } {
  const valid: Transaction[] = [];
  const invalid: TxResult[] = [];
  for (const entry of raw) {
    const parsed = Transaction.safeParse(entry);
    if (parsed.success) {
      valid.push(parsed.data);
      continue;
    }
    const clientTxId = z.object({ clientTxId: z.uuid() }).safeParse(entry);
    if (clientTxId.success) {
      invalid.push({
        clientTxId: clientTxId.data.clientTxId,
        status: "rejected",
        code: "validation",
        message: parsed.error.issues[0]?.message ?? "Invalid mutation",
      });
    }
  }
  return { valid, invalid };
}

const sameTeams = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function attachSocketGateway(io: SyncServer, deps: SocketGatewayDeps): void {
  const { logger } = deps;

  const authenticate = async (socket: SyncSocket): Promise<void> => {
    const { token } = HandshakeAuth.parse(socket.handshake.auth);
    const { user, expiresAt } = await deps.auth.authenticateSession(token);
    socket.data.token = token;
    socket.data.expiresAt = expiresAt;
    socket.data.context = await deps.access.contextFor(user);
    socket.data.viewing = new Map();
  };

  // Only a bad token is "unauthorized": clients drop their session on that, so a database hiccup must not look like one.
  io.use((socket, next) => {
    authenticate(socket).then(
      () => next(),
      (error: unknown) => {
        const rejected = error instanceof z.ZodError || (error instanceof AppError && error.status === 401);
        if (!rejected) logger.error({ err: error }, "socket authentication failed");
        next(new Error(rejected ? "unauthorized" : "unavailable"));
      },
    );
  });

  io.on("connection", (socket: SyncSocket) => {
    const initial = socket.data.context;
    const workspaceId = initial.user.workspaceId;
    const log = logger.child({ socketId: socket.id, userId: initial.user.id });
    const context = (): AccessContext => socket.data.context;
    for (const teamId of initial.teamIds) void socket.join(teamRoom(workspaceId, teamId));
    log.info({ teams: initial.teamIds.length }, "socket connected");

    const pushBucket = new TokenBucket(300, 50);
    const catchUpBucket = new TokenBucket(10, 1);
    const presenceBucket = new TokenBucket(30, 5);

    // A live socket outlives its token unless something cuts it off; the client reconnects and gets a 401.
    const expiry = setTimeout(() => {
      log.info("token expired; disconnecting");
      socket.disconnect(true);
    }, Math.min(MAX_TIMER_MS, Math.max(0, socket.data.expiresAt - Date.now())));

    const member = { userId: initial.user.id, connectionId: socket.id };

    // Presence handlers await Redis between steps; running them one at a time per socket keeps a fast
    // sequence of view changes from interleaving and leaving stale entries behind.
    let presenceChain: Promise<void> = Promise.resolve();
    const serialize = (work: () => Promise<void>): void => {
      presenceChain = presenceChain.then(work).catch((error: unknown) => log.warn({ err: error }, "presence update failed"));
    };

    const publish = (issueId: string, teamId: string, viewerIds: string[]): void => {
      io.to(teamRoom(workspaceId, teamId)).emit(socketEvents.presenceUpdate, { issueId, viewerIds });
    };

    const leave = async (issueId: string): Promise<void> => {
      const entry = socket.data.viewing.get(issueId);
      if (!entry) return;
      socket.data.viewing.delete(issueId);
      publish(issueId, entry.teamId, await deps.presence.remove(issueId, member));
    };

    const touch = async (issueId: string, teamId: string): Promise<void> => {
      const viewers = await deps.presence.touch(issueId, member, deps.presenceTtlMs);
      const previous = socket.data.viewing.get(issueId);
      socket.data.viewing.set(issueId, { teamId, viewers });
      if (previous?.viewers.join() !== viewers.join()) publish(issueId, teamId, viewers);
    };

    const refreshAccess = async (): Promise<void> => {
      let next: AccessContext;
      try {
        const { user } = await deps.auth.authenticateSession(socket.data.token);
        next = await deps.access.contextFor(user);
      } catch (error) {
        if (error instanceof AppError && error.status === 401) {
          log.info("access revoked; disconnecting");
          socket.disconnect(true);
        } else {
          log.warn({ err: error }, "access refresh failed");
        }
        return;
      }
      const previous = context();
      socket.data.context = next;
      if (sameTeams(previous.teamIds, next.teamIds)) return;
      const allowed = new Set(next.teamIds);
      for (const teamId of previous.teamIds) if (!allowed.has(teamId)) void socket.leave(teamRoom(workspaceId, teamId));
      for (const teamId of next.teamIds) void socket.join(teamRoom(workspaceId, teamId));
      serialize(async () => {
        for (const [issueId, entry] of [...socket.data.viewing]) if (!allowed.has(entry.teamId)) await leave(issueId);
      });
      log.info({ teams: next.teamIds.length }, "team access changed; asking client to resync");
      socket.emit(socketEvents.resync, { reason: "access_changed" });
    };
    const accessTimer = setInterval(() => void refreshAccess(), deps.accessRefreshMs);

    socket.on(socketEvents.push, async (payload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const { txs } = PushRequest.parse(payload);
        if (!pushBucket.take(txs.length)) {
          ack(rateLimited());
          return;
        }
        const { valid, invalid } = parseTransactions(txs);
        const applied = await deps.mutations.push(context().actor, valid);
        ack({ ok: true, data: { results: [...invalid, ...applied] } });
      } catch (error) {
        log.error({ err: error }, "push failed");
        ack(failure(error));
      }
    });

    socket.on(socketEvents.catchUp, async (payload, ack) => {
      if (typeof ack !== "function") return;
      if (!catchUpBucket.take()) {
        ack(rateLimited());
        return;
      }
      try {
        const { lastSyncId, epoch } = CatchUpRequest.parse(payload);
        const { teamIds } = context();
        ack({ ok: true, data: await deps.catchUp.catchUp(workspaceId, teamIds, lastSyncId, epoch) });
      } catch (error) {
        log.error({ err: error }, "catch-up failed");
        ack(failure(error));
      }
    });

    // The leader tab reports every issue open in any tab of this browser, so a socket can view several at once.
    socket.on(socketEvents.presenceView, (payload) => {
      if (!presenceBucket.take()) return;
      const parsed = PresenceViewRequest.safeParse(payload);
      if (!parsed.success) return;
      serialize(async () => {
        const wanted = new Set(parsed.data.issueIds);
        for (const issueId of [...socket.data.viewing.keys()]) if (!wanted.has(issueId)) await leave(issueId);
        for (const issueId of wanted) {
          if (socket.data.viewing.has(issueId)) continue;
          const teamId = await deps.workspaces.findIssueTeamId(workspaceId, issueId);
          if (teamId && context().teamIds.includes(teamId)) await touch(issueId, teamId);
        }
      });
    });

    socket.on(socketEvents.presenceHeartbeat, () => {
      if (!presenceBucket.take()) return;
      serialize(async () => {
        for (const [issueId, entry] of [...socket.data.viewing]) await touch(issueId, entry.teamId);
      });
    });

    socket.on("disconnect", (reason) => {
      clearTimeout(expiry);
      clearInterval(accessTimer);
      log.info({ reason }, "socket disconnected");
      serialize(async () => {
        await Promise.all([...socket.data.viewing.keys()].map(leave));
      });
    });
  });
}
