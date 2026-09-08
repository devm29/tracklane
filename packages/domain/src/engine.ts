import type { Comment, Issue, ModelMap, ModelName, Role, Team } from "./entities.js";
import type { IssuePatch, Mutation, RejectionCode } from "./mutations.js";
import { canTransition, statusLabels } from "./workflow.js";

export interface EntityReader {
  get<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined;
}

export interface MutationActor {
  userId: string;
  workspaceId: string;
  role: Role;
}

export interface ExecuteOptions {
  actor: MutationActor;
  now: string;
  allocateIssueNumber: (teamId: string) => number;
}

interface WriteBase {
  id: string;
  teamId: string;
  changedFields: string[];
}

export type EntityWrite =
  | (WriteBase & { model: "issue"; action: "upsert"; data: Issue })
  | (WriteBase & { model: "comment"; action: "upsert"; data: Comment })
  | (WriteBase & { model: "comment"; action: "remove"; data: null });

export interface Rejection {
  code: RejectionCode;
  message: string;
}

/** `write: null` means the mutation is valid but changes nothing, so it must not consume a syncId. */
export type MutationResult = { ok: true; write: EntityWrite | null } | { ok: false; rejection: Rejection };

export interface EntityRef {
  model: ModelName;
  id: string;
}

class RejectionError extends Error {
  constructor(readonly code: RejectionCode, message: string) {
    super(message);
  }
}

function reject(code: RejectionCode, message: string): never {
  throw new RejectionError(code, message);
}

export function canAccessTeam(team: Team, actor: MutationActor): boolean {
  return team.workspaceId === actor.workspaceId && (actor.role === "admin" || team.memberIds.includes(actor.userId));
}

function requireTeam(reader: EntityReader, teamId: string, actor: MutationActor): Team {
  const team = reader.get("team", teamId);
  if (!team || team.workspaceId !== actor.workspaceId) reject("not_found", "Team not found");
  if (!canAccessTeam(team, actor)) reject("forbidden", `You are not a member of ${team.name}`);
  return team;
}

function requireIssue(reader: EntityReader, id: string, actor: MutationActor): { issue: Issue; team: Team } {
  const issue = reader.get("issue", id);
  if (!issue || issue.workspaceId !== actor.workspaceId) reject("not_found", "Issue not found");
  return { issue, team: requireTeam(reader, issue.teamId, actor) };
}

interface IssueRefs {
  assigneeId?: string | null | undefined;
  projectId?: string | null | undefined;
  labelIds?: readonly string[] | undefined;
}

function validateIssueRefs(reader: EntityReader, team: Team, refs: IssueRefs, actor: MutationActor): void {
  if (refs.assigneeId != null && !team.memberIds.includes(refs.assigneeId)) {
    reject("validation", "Assignee must be a member of the team");
  }
  if (refs.projectId != null) {
    const project = reader.get("project", refs.projectId);
    if (!project || project.teamId !== team.id) reject("validation", "Project does not belong to this team");
  }
  for (const labelId of refs.labelIds ?? []) {
    const label = reader.get("label", labelId);
    if (!label || label.workspaceId !== actor.workspaceId) reject("validation", "Unknown label");
  }
}

function dedupe<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
  }
  return a === b;
}

export function applyIssuePatch(issue: Issue, patch: IssuePatch, now: string): { next: Issue; changedFields: string[] } {
  const next: Issue = { ...issue };
  const changedFields: string[] = [];
  const assign = <K extends keyof IssuePatch & keyof Issue>(key: K, value: Issue[K]): void => {
    if (!sameValue(next[key], value)) {
      next[key] = value;
      changedFields.push(key);
    }
  };
  if (patch.title !== undefined) assign("title", patch.title);
  if (patch.description !== undefined) assign("description", patch.description);
  if (patch.status !== undefined) assign("status", patch.status);
  if (patch.priority !== undefined) assign("priority", patch.priority);
  if (patch.assigneeId !== undefined) assign("assigneeId", patch.assigneeId);
  if (patch.projectId !== undefined) assign("projectId", patch.projectId);
  if (patch.labelIds !== undefined) assign("labelIds", dedupe(patch.labelIds));
  if (patch.sortOrder !== undefined) assign("sortOrder", patch.sortOrder);
  if (changedFields.length > 0) next.updatedAt = now;
  return { next, changedFields };
}

function execute(reader: EntityReader, mutation: Mutation, options: ExecuteOptions): EntityWrite | null {
  const { actor, now } = options;
  switch (mutation.kind) {
    case "issue.create": {
      if (reader.get("issue", mutation.id)) reject("conflict", "Issue already exists");
      const { input } = mutation;
      const team = requireTeam(reader, input.teamId, actor);
      validateIssueRefs(reader, team, input, actor);
      const data: Issue = {
        id: mutation.id,
        workspaceId: actor.workspaceId,
        teamId: team.id,
        projectId: input.projectId,
        number: options.allocateIssueNumber(team.id),
        title: input.title,
        description: input.description,
        status: input.status,
        priority: input.priority,
        assigneeId: input.assigneeId,
        creatorId: actor.userId,
        labelIds: dedupe(input.labelIds),
        sortOrder: input.sortOrder,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      return { model: "issue", action: "upsert", id: data.id, teamId: team.id, data, changedFields: Object.keys(data) };
    }
    case "issue.update": {
      const { issue, team } = requireIssue(reader, mutation.id, actor);
      if (issue.archivedAt) reject("archived", "Archived issues can't be edited");
      const { patch } = mutation;
      if (patch.status !== undefined && !canTransition(issue.status, patch.status)) {
        reject(
          "invalid_transition",
          `Can't move an issue from ${statusLabels[issue.status]} to ${statusLabels[patch.status]}`,
        );
      }
      validateIssueRefs(reader, team, patch, actor);
      const { next, changedFields } = applyIssuePatch(issue, patch, now);
      if (changedFields.length === 0) return null;
      return { model: "issue", action: "upsert", id: issue.id, teamId: team.id, data: next, changedFields };
    }
    case "issue.archive":
    case "issue.unarchive": {
      const { issue, team } = requireIssue(reader, mutation.id, actor);
      const archive = mutation.kind === "issue.archive";
      if (archive === (issue.archivedAt !== null)) {
        reject("conflict", archive ? "Issue is already archived" : "Issue is not archived");
      }
      const data: Issue = { ...issue, archivedAt: archive ? now : null, updatedAt: now };
      return { model: "issue", action: "upsert", id: issue.id, teamId: team.id, data, changedFields: ["archivedAt"] };
    }
    case "comment.create": {
      if (reader.get("comment", mutation.id)) reject("conflict", "Comment already exists");
      const { issue, team } = requireIssue(reader, mutation.input.issueId, actor);
      if (issue.archivedAt) reject("archived", "Archived issues can't receive comments");
      const data: Comment = {
        id: mutation.id,
        workspaceId: actor.workspaceId,
        teamId: team.id,
        issueId: issue.id,
        authorId: actor.userId,
        body: mutation.input.body,
        createdAt: now,
      };
      return { model: "comment", action: "upsert", id: data.id, teamId: team.id, data, changedFields: Object.keys(data) };
    }
    case "comment.delete": {
      const comment = reader.get("comment", mutation.id);
      if (!comment || comment.workspaceId !== actor.workspaceId) reject("not_found", "Comment not found");
      requireTeam(reader, comment.teamId, actor);
      if (comment.authorId !== actor.userId && actor.role !== "admin") {
        reject("forbidden", "Only the author can delete a comment");
      }
      return { model: "comment", action: "remove", id: comment.id, teamId: comment.teamId, data: null, changedFields: [] };
    }
  }
}

/**
 * The single source of mutation semantics. The server runs it inside a Mongo
 * transaction against freshly loaded documents; clients run it to apply
 * optimistic changes and to rebase pending work over new server state.
 */
export function executeMutation(reader: EntityReader, mutation: Mutation, options: ExecuteOptions): MutationResult {
  try {
    return { ok: true, write: execute(reader, mutation, options) };
  } catch (error) {
    if (error instanceof RejectionError) return { ok: false, rejection: { code: error.code, message: error.message } };
    throw error;
  }
}

/**
 * Entities executeMutation may read. Some refs are only known once an earlier
 * ref is loaded (an update needs the issue before it knows the team), so the
 * server calls this until it stops returning anything new.
 */
export function referencedEntities(mutation: Mutation, reader: EntityReader): EntityRef[] {
  const refs: EntityRef[] = [];
  const issueRefs = (teamId: string | undefined, input: IssueRefs): void => {
    if (teamId) refs.push({ model: "team", id: teamId });
    if (input.projectId) refs.push({ model: "project", id: input.projectId });
    for (const id of input.labelIds ?? []) refs.push({ model: "label", id });
  };
  switch (mutation.kind) {
    case "issue.create":
      refs.push({ model: "issue", id: mutation.id });
      issueRefs(mutation.input.teamId, mutation.input);
      break;
    case "issue.update":
      refs.push({ model: "issue", id: mutation.id });
      issueRefs(reader.get("issue", mutation.id)?.teamId, mutation.patch);
      break;
    case "issue.archive":
    case "issue.unarchive":
      refs.push({ model: "issue", id: mutation.id });
      issueRefs(reader.get("issue", mutation.id)?.teamId, {});
      break;
    case "comment.create":
      refs.push({ model: "comment", id: mutation.id }, { model: "issue", id: mutation.input.issueId });
      issueRefs(reader.get("issue", mutation.input.issueId)?.teamId, {});
      break;
    case "comment.delete": {
      refs.push({ model: "comment", id: mutation.id });
      issueRefs(reader.get("comment", mutation.id)?.teamId, {});
      break;
    }
  }
  return refs;
}
