import type { IssueStatus, LabelColor, Priority, ProjectStatus, Role } from "@tracklane/domain";
import { type Connection, type Model, Schema } from "mongoose";

export interface WorkspaceDoc {
  _id: string;
  name: string;
  slug: string;
}

export interface UserDoc {
  _id: string;
  workspaceId: string;
  name: string;
  email: string;
  role: Role;
  avatarHue: number;
  passwordHash: string;
}

export interface TeamDoc {
  _id: string;
  workspaceId: string;
  key: string;
  name: string;
  memberIds: string[];
}

export interface ProjectDoc {
  _id: string;
  workspaceId: string;
  teamId: string;
  name: string;
  description: string;
  status: ProjectStatus;
  targetDate: Date | null;
}

export interface LabelDoc {
  _id: string;
  workspaceId: string;
  name: string;
  color: LabelColor;
}

export interface IssueDoc {
  _id: string;
  workspaceId: string;
  teamId: string;
  projectId: string | null;
  number: number;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assigneeId: string | null;
  creatorId: string;
  labelIds: string[];
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface CommentDoc {
  _id: string;
  workspaceId: string;
  teamId: string;
  issueId: string;
  authorId: string;
  body: string;
  createdAt: Date;
}

export interface SyncActionDoc {
  workspaceId: string;
  syncId: number;
  model: "issue" | "comment";
  action: "upsert" | "remove";
  modelId: string;
  teamId: string;
  data: unknown;
  changedFields: string[];
  clientTxId: string | null;
  actorId: string;
  createdAt: Date;
}

export interface CounterDoc {
  _id: string;
  value: number;
  /** Only meaningful on workspace sync counters. */
  epoch?: string;
}

const id = { type: String, required: true } as const;
const nullableId = { type: String, default: null } as const;

function workspaceSchema(): Schema<WorkspaceDoc> {
  return new Schema<WorkspaceDoc>(
    { _id: id, name: { type: String, required: true }, slug: { type: String, required: true, unique: true } },
    { versionKey: false },
  );
}

function userSchema(): Schema<UserDoc> {
  return new Schema<UserDoc>(
    {
      _id: id,
      workspaceId: { ...id, index: true },
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      role: { type: String, enum: ["admin", "member"], required: true },
      avatarHue: { type: Number, required: true },
      passwordHash: { type: String, required: true },
    },
    { versionKey: false },
  );
}

function teamSchema(): Schema<TeamDoc> {
  const schema = new Schema<TeamDoc>(
    {
      _id: id,
      workspaceId: id,
      key: { type: String, required: true },
      name: { type: String, required: true },
      memberIds: { type: [String], default: [] },
    },
    { versionKey: false },
  );
  schema.index({ workspaceId: 1, key: 1 }, { unique: true });
  return schema;
}

function projectSchema(): Schema<ProjectDoc> {
  return new Schema<ProjectDoc>(
    {
      _id: id,
      workspaceId: { ...id, index: true },
      teamId: id,
      name: { type: String, required: true },
      description: { type: String, default: "" },
      status: { type: String, enum: ["planned", "started", "paused", "completed"], required: true },
      targetDate: { type: Date, default: null },
    },
    { versionKey: false },
  );
}

function labelSchema(): Schema<LabelDoc> {
  return new Schema<LabelDoc>(
    {
      _id: id,
      workspaceId: { ...id, index: true },
      name: { type: String, required: true },
      color: { type: String, required: true },
    },
    { versionKey: false },
  );
}

function issueSchema(): Schema<IssueDoc> {
  const schema = new Schema<IssueDoc>(
    {
      _id: id,
      workspaceId: id,
      teamId: id,
      projectId: nullableId,
      number: { type: Number, required: true },
      title: { type: String, required: true },
      description: { type: String, default: "" },
      status: { type: String, required: true },
      priority: { type: Number, required: true },
      assigneeId: nullableId,
      creatorId: id,
      labelIds: { type: [String], default: [] },
      sortOrder: { type: Number, required: true },
      createdAt: { type: Date, required: true },
      updatedAt: { type: Date, required: true },
      archivedAt: { type: Date, default: null },
    },
    { versionKey: false },
  );
  schema.index({ teamId: 1, number: 1 }, { unique: true });
  schema.index({ workspaceId: 1, teamId: 1, updatedAt: -1, _id: -1 });
  return schema;
}

function commentSchema(): Schema<CommentDoc> {
  const schema = new Schema<CommentDoc>(
    {
      _id: id,
      workspaceId: id,
      teamId: id,
      issueId: { ...id, index: true },
      authorId: id,
      body: { type: String, required: true },
      createdAt: { type: Date, required: true },
    },
    { versionKey: false },
  );
  schema.index({ workspaceId: 1, teamId: 1 });
  return schema;
}

function syncActionSchema(): Schema<SyncActionDoc> {
  const schema = new Schema<SyncActionDoc>(
    {
      workspaceId: { type: String, required: true },
      syncId: { type: Number, required: true },
      model: { type: String, enum: ["issue", "comment"], required: true },
      action: { type: String, enum: ["upsert", "remove"], required: true },
      modelId: { type: String, required: true },
      teamId: { type: String, required: true },
      data: { type: Schema.Types.Mixed, default: null },
      changedFields: { type: [String], default: [] },
      clientTxId: { type: String, default: null },
      actorId: { type: String, required: true },
      createdAt: { type: Date, required: true },
    },
    { versionKey: false, minimize: false },
  );
  schema.index({ workspaceId: 1, syncId: 1 }, { unique: true });
  schema.index({ workspaceId: 1, teamId: 1, syncId: 1 });
  // Makes push idempotent: a replayed outbox entry finds its original syncId instead of applying twice.
  schema.index(
    { workspaceId: 1, clientTxId: 1 },
    { unique: true, partialFilterExpression: { clientTxId: { $type: "string" } } },
  );
  return schema;
}

function counterSchema(): Schema<CounterDoc> {
  return new Schema<CounterDoc>(
    { _id: id, value: { type: Number, required: true, default: 0 }, epoch: { type: String } },
    { versionKey: false },
  );
}

export interface Models {
  Workspace: Model<WorkspaceDoc>;
  User: Model<UserDoc>;
  Team: Model<TeamDoc>;
  Project: Model<ProjectDoc>;
  Label: Model<LabelDoc>;
  Issue: Model<IssueDoc>;
  Comment: Model<CommentDoc>;
  SyncAction: Model<SyncActionDoc>;
  Counter: Model<CounterDoc>;
}

const SYNC_LOG_TTL_INDEX = "createdAt_ttl";

/**
 * Compaction: clients that fall behind the retained window re-bootstrap. The
 * TTL index is managed by hand rather than declared on the schema because its
 * expiry comes from config, and autoIndex can't change an existing index's
 * options; collMod can.
 */
async function ensureSyncLogTtl(model: Model<SyncActionDoc>, retentionDays: number): Promise<void> {
  const expireAfterSeconds = retentionDays * 24 * 60 * 60;
  const indexes = await model.collection.indexes();
  const existing = indexes.find((index) => index.name === SYNC_LOG_TTL_INDEX);
  // Databases created before the index was named still carry the schema-generated one.
  const legacy = indexes.find((index) => index.name === "createdAt_1" && index.expireAfterSeconds !== undefined);
  if (legacy) await model.collection.dropIndex("createdAt_1");
  if (!existing) {
    await model.collection.createIndex({ createdAt: 1 }, { name: SYNC_LOG_TTL_INDEX, expireAfterSeconds }, undefined);
    return;
  }
  if (existing.expireAfterSeconds === expireAfterSeconds) return;
  await model.db.db?.command({
    collMod: model.collection.collectionName,
    index: { name: SYNC_LOG_TTL_INDEX, expireAfterSeconds },
  });
}

/** Builds indexes; listed explicitly because the models have unrelated document types. */
export async function initModels(models: Models, options: { syncLogRetentionDays: number }): Promise<void> {
  await Promise.all([
    models.Workspace.init(),
    models.User.init(),
    models.Team.init(),
    models.Project.init(),
    models.Label.init(),
    models.Issue.init(),
    models.Comment.init(),
    models.SyncAction.init(),
    models.Counter.init(),
  ]);
  await ensureSyncLogTtl(models.SyncAction, options.syncLogRetentionDays);
}

export async function clearModels(models: Models): Promise<void> {
  await Promise.all([
    models.Workspace.deleteMany({}),
    models.User.deleteMany({}),
    models.Team.deleteMany({}),
    models.Project.deleteMany({}),
    models.Label.deleteMany({}),
    models.Issue.deleteMany({}),
    models.Comment.deleteMany({}),
    models.SyncAction.deleteMany({}),
    models.Counter.deleteMany({}),
  ]);
}

export function registerModels(connection: Connection): Models {
  return {
    Workspace: connection.model<WorkspaceDoc>("Workspace", workspaceSchema(), "workspaces"),
    User: connection.model<UserDoc>("User", userSchema(), "users"),
    Team: connection.model<TeamDoc>("Team", teamSchema(), "teams"),
    Project: connection.model<ProjectDoc>("Project", projectSchema(), "projects"),
    Label: connection.model<LabelDoc>("Label", labelSchema(), "labels"),
    Issue: connection.model<IssueDoc>("Issue", issueSchema(), "issues"),
    Comment: connection.model<CommentDoc>("Comment", commentSchema(), "comments"),
    SyncAction: connection.model<SyncActionDoc>("SyncAction", syncActionSchema(), "sync_actions"),
    Counter: connection.model<CounterDoc>("Counter", counterSchema(), "counters"),
  };
}
