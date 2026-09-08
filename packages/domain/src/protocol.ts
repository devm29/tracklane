import { z } from "zod";
import { Comment, Id, Issue, Label, Project, Team, User, Workspace } from "./entities.js";
import { SyncDelta } from "./deltas.js";
import { TxResult } from "./mutations.js";

/**
 * Identifies one lifetime of a workspace's sync counter. A reseed or restore
 * starts a new epoch, and a cursor from an older epoch must never be used to
 * catch up, even if its number happens to be valid in the new one.
 */
export const SyncEpoch = z.string().min(1).max(64);

export const BootstrapPayload = z.object({
  lastSyncId: z.number().int().nonnegative(),
  epoch: SyncEpoch,
  workspace: Workspace,
  me: User,
  users: z.array(User),
  teams: z.array(Team),
  projects: z.array(Project),
  labels: z.array(Label),
  issues: z.array(Issue),
  comments: z.array(Comment),
});
export type BootstrapPayload = z.infer<typeof BootstrapPayload>;

export const MAX_PUSH_BATCH = 100;

/** Entries stay `unknown` here: the server validates each transaction on its own so one bad entry can't block the batch. */
export const PushRequest = z.object({
  txs: z.array(z.unknown()).min(1).max(MAX_PUSH_BATCH),
});
export type PushRequest = z.infer<typeof PushRequest>;

export const PushResponse = z.object({
  results: z.array(TxResult),
});
export type PushResponse = z.infer<typeof PushResponse>;

export const CatchUpRequest = z.object({
  lastSyncId: z.number().int().nonnegative(),
  epoch: SyncEpoch,
});
export type CatchUpRequest = z.infer<typeof CatchUpRequest>;

export const CatchUpResponse = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("deltas"), deltas: z.array(SyncDelta), lastSyncId: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("rebootstrap"), lastSyncId: z.number().int().nonnegative() }),
]);
export type CatchUpResponse = z.infer<typeof CatchUpResponse>;

export const PresenceViewRequest = z.object({
  issueIds: z.array(Id).max(20),
});
export type PresenceViewRequest = z.infer<typeof PresenceViewRequest>;

export const PresenceUpdate = z.object({
  issueId: Id,
  viewerIds: z.array(Id),
});
export type PresenceUpdate = z.infer<typeof PresenceUpdate>;

export const LoginRequest = z.object({
  email: z.email(),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const LoginResponse = z.object({
  token: z.string(),
  user: User,
  workspace: Workspace,
});
export type LoginResponse = z.infer<typeof LoginResponse>;

export const DemoAccount = z.object({
  name: z.string(),
  email: z.email(),
  avatarHue: z.number(),
  teams: z.array(z.string()),
});
export type DemoAccount = z.infer<typeof DemoAccount>;

/** Sent when the server changes what a socket may see; the client re-bootstraps to drop or fetch whole teams. */
export const ResyncNotice = z.object({
  reason: z.enum(["access_changed"]),
});
export type ResyncNotice = z.infer<typeof ResyncNotice>;

export const socketEvents = {
  push: "sync:push",
  catchUp: "sync:catchup",
  delta: "sync:delta",
  resync: "sync:resync",
  presenceView: "presence:view",
  presenceHeartbeat: "presence:heartbeat",
  presenceUpdate: "presence:update",
} as const;

export const ErrorBody = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorBody = z.infer<typeof ErrorBody>;

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export function socketAck<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true), data }),
    z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
  ]);
}
