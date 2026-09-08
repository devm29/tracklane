import { z } from "zod";
import { Comment, Id, Issue, Timestamp } from "./entities.js";

const deltaBase = {
  syncId: z.number().int().positive(),
  modelId: Id,
  teamId: Id,
  changedFields: z.array(z.string()),
  clientTxId: Id.nullable(),
  actorId: Id,
  createdAt: Timestamp,
};

export const IssueUpsertDelta = z.object({
  ...deltaBase,
  model: z.literal("issue"),
  action: z.literal("upsert"),
  data: Issue,
});

export const CommentUpsertDelta = z.object({
  ...deltaBase,
  model: z.literal("comment"),
  action: z.literal("upsert"),
  data: Comment,
});

export const CommentRemoveDelta = z.object({
  ...deltaBase,
  model: z.literal("comment"),
  action: z.literal("remove"),
  data: z.null(),
});

export const SyncDelta = z.union([IssueUpsertDelta, CommentUpsertDelta, CommentRemoveDelta]);
export type SyncDelta = z.infer<typeof SyncDelta>;
export type SyncedModel = SyncDelta["model"];
