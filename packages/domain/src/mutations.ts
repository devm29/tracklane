import { z } from "zod";
import { Id, IssueStatus, Priority, Timestamp } from "./entities.js";

export const TITLE_MAX_LENGTH = 200;
export const DESCRIPTION_MAX_LENGTH = 20_000;
export const COMMENT_MAX_LENGTH = 5_000;

export const IssueTitle = z.string().trim().min(1, "Title can't be empty").max(TITLE_MAX_LENGTH, "Titles are limited to 200 characters");
export const IssueDescription = z.string().max(DESCRIPTION_MAX_LENGTH, "Descriptions are limited to 20,000 characters");
export const LabelIds = z.array(Id).max(10, "An issue can have up to 10 labels");
export const CommentBody = z
  .string()
  .trim()
  .min(1, "Comment can't be empty")
  .max(COMMENT_MAX_LENGTH, "Comments are limited to 5,000 characters");

export const IssueCreateInput = z.object({
  teamId: Id,
  title: IssueTitle,
  description: IssueDescription,
  status: IssueStatus,
  priority: Priority,
  assigneeId: Id.nullable(),
  projectId: Id.nullable(),
  labelIds: LabelIds,
  sortOrder: z.number(),
});
export type IssueCreateInput = z.infer<typeof IssueCreateInput>;

export const IssuePatch = z
  .object({
    title: IssueTitle,
    description: IssueDescription,
    status: IssueStatus,
    priority: Priority,
    assigneeId: Id.nullable(),
    projectId: Id.nullable(),
    labelIds: LabelIds,
    sortOrder: z.number(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0, "Patch must change at least one field");
export type IssuePatch = z.infer<typeof IssuePatch>;
export type IssuePatchField = keyof IssuePatch;

export const CommentCreateInput = z.object({
  issueId: Id,
  body: CommentBody,
});
export type CommentCreateInput = z.infer<typeof CommentCreateInput>;

export const Mutation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("issue.create"), id: Id, input: IssueCreateInput }),
  z.object({ kind: z.literal("issue.update"), id: Id, patch: IssuePatch }),
  z.object({ kind: z.literal("issue.archive"), id: Id }),
  z.object({ kind: z.literal("issue.unarchive"), id: Id }),
  z.object({ kind: z.literal("comment.create"), id: Id, input: CommentCreateInput }),
  z.object({ kind: z.literal("comment.delete"), id: Id }),
]);
export type Mutation = z.infer<typeof Mutation>;
export type MutationKind = Mutation["kind"];

export const Transaction = z.object({
  clientTxId: Id,
  mutation: Mutation,
  createdAt: Timestamp,
});
export type Transaction = z.infer<typeof Transaction>;

export const rejectionCodes = [
  "forbidden",
  "not_found",
  "invalid_transition",
  "validation",
  "conflict",
  "archived",
] as const;
export const RejectionCode = z.enum(rejectionCodes);
export type RejectionCode = z.infer<typeof RejectionCode>;

export const TxResult = z.discriminatedUnion("status", [
  z.object({ clientTxId: Id, status: z.literal("accepted"), syncId: z.number().int().positive() }),
  z.object({ clientTxId: Id, status: z.literal("noop") }),
  z.object({ clientTxId: Id, status: z.literal("rejected"), code: RejectionCode, message: z.string() }),
]);
export type TxResult = z.infer<typeof TxResult>;

export function mutationTarget(mutation: Mutation): { model: "issue" | "comment"; id: string } {
  switch (mutation.kind) {
    case "issue.create":
    case "issue.update":
    case "issue.archive":
    case "issue.unarchive":
      return { model: "issue", id: mutation.id };
    case "comment.create":
    case "comment.delete":
      return { model: "comment", id: mutation.id };
  }
}
