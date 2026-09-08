import { z } from "zod";

export const Id = z.uuid();
export const Timestamp = z.iso.datetime({ offset: true });

export const issueStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] as const;
export const IssueStatus = z.enum(issueStatuses);
export type IssueStatus = z.infer<typeof IssueStatus>;

export const priorities = [0, 1, 2, 3, 4] as const;
export const Priority = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export type Priority = z.infer<typeof Priority>;

export const Role = z.enum(["admin", "member"]);
export type Role = z.infer<typeof Role>;

export const Workspace = z.object({
  id: Id,
  name: z.string(),
  slug: z.string(),
});
export type Workspace = z.infer<typeof Workspace>;

export const User = z.object({
  id: Id,
  workspaceId: Id,
  name: z.string(),
  email: z.email(),
  role: Role,
  avatarHue: z.number().int().min(0).max(360),
});
export type User = z.infer<typeof User>;

export const Team = z.object({
  id: Id,
  workspaceId: Id,
  key: z.string().regex(/^[A-Z]{2,5}$/),
  name: z.string(),
  memberIds: z.array(Id),
});
export type Team = z.infer<typeof Team>;

export const ProjectStatus = z.enum(["planned", "started", "paused", "completed"]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const Project = z.object({
  id: Id,
  workspaceId: Id,
  teamId: Id,
  name: z.string(),
  description: z.string(),
  status: ProjectStatus,
  targetDate: z.string().nullable(),
});
export type Project = z.infer<typeof Project>;

export const LabelColor = z.enum(["red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "gray"]);
export type LabelColor = z.infer<typeof LabelColor>;

export const Label = z.object({
  id: Id,
  workspaceId: Id,
  name: z.string(),
  color: LabelColor,
});
export type Label = z.infer<typeof Label>;

export const Issue = z.object({
  id: Id,
  workspaceId: Id,
  teamId: Id,
  projectId: Id.nullable(),
  number: z.number().int().nonnegative(),
  title: z.string(),
  description: z.string(),
  status: IssueStatus,
  priority: Priority,
  assigneeId: Id.nullable(),
  creatorId: Id,
  labelIds: z.array(Id),
  sortOrder: z.number(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  archivedAt: Timestamp.nullable(),
});
export type Issue = z.infer<typeof Issue>;

export const Comment = z.object({
  id: Id,
  workspaceId: Id,
  teamId: Id,
  issueId: Id,
  authorId: Id,
  body: z.string(),
  createdAt: Timestamp,
});
export type Comment = z.infer<typeof Comment>;

export interface ModelMap {
  issue: Issue;
  comment: Comment;
  project: Project;
  team: Team;
  user: User;
  label: Label;
}
export type ModelName = keyof ModelMap;
export type AnyEntity = ModelMap[ModelName];

export const modelNames = ["issue", "comment", "project", "team", "user", "label"] as const satisfies readonly ModelName[];
