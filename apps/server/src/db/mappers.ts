import type { Comment, Issue, Label, Project, Team, User, Workspace } from "@tracklane/domain";
import type { CommentDoc, IssueDoc, LabelDoc, ProjectDoc, TeamDoc, UserDoc, WorkspaceDoc } from "./models.js";

const iso = (date: Date): string => date.toISOString();
const isoOrNull = (date: Date | null): string | null => (date ? date.toISOString() : null);

export function toWorkspace(doc: WorkspaceDoc): Workspace {
  return { id: doc._id, name: doc.name, slug: doc.slug };
}

export function toUser(doc: UserDoc): User {
  return { id: doc._id, workspaceId: doc.workspaceId, name: doc.name, email: doc.email, role: doc.role, avatarHue: doc.avatarHue };
}

export function toTeam(doc: TeamDoc): Team {
  return { id: doc._id, workspaceId: doc.workspaceId, key: doc.key, name: doc.name, memberIds: [...doc.memberIds] };
}

export function toProject(doc: ProjectDoc): Project {
  return {
    id: doc._id,
    workspaceId: doc.workspaceId,
    teamId: doc.teamId,
    name: doc.name,
    description: doc.description,
    status: doc.status,
    targetDate: doc.targetDate ? iso(doc.targetDate).slice(0, 10) : null,
  };
}

export function toLabel(doc: LabelDoc): Label {
  return { id: doc._id, workspaceId: doc.workspaceId, name: doc.name, color: doc.color };
}

export function toIssue(doc: IssueDoc): Issue {
  return {
    id: doc._id,
    workspaceId: doc.workspaceId,
    teamId: doc.teamId,
    projectId: doc.projectId,
    number: doc.number,
    title: doc.title,
    description: doc.description,
    status: doc.status,
    priority: doc.priority,
    assigneeId: doc.assigneeId,
    creatorId: doc.creatorId,
    labelIds: [...doc.labelIds],
    sortOrder: doc.sortOrder,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
    archivedAt: isoOrNull(doc.archivedAt),
  };
}

export function fromIssue(issue: Issue): IssueDoc {
  return {
    _id: issue.id,
    workspaceId: issue.workspaceId,
    teamId: issue.teamId,
    projectId: issue.projectId,
    number: issue.number,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    assigneeId: issue.assigneeId,
    creatorId: issue.creatorId,
    labelIds: issue.labelIds,
    sortOrder: issue.sortOrder,
    createdAt: new Date(issue.createdAt),
    updatedAt: new Date(issue.updatedAt),
    archivedAt: issue.archivedAt ? new Date(issue.archivedAt) : null,
  };
}

export function toComment(doc: CommentDoc): Comment {
  return {
    id: doc._id,
    workspaceId: doc.workspaceId,
    teamId: doc.teamId,
    issueId: doc.issueId,
    authorId: doc.authorId,
    body: doc.body,
    createdAt: iso(doc.createdAt),
  };
}

export function fromComment(comment: Comment): CommentDoc {
  return {
    _id: comment.id,
    workspaceId: comment.workspaceId,
    teamId: comment.teamId,
    issueId: comment.issueId,
    authorId: comment.authorId,
    body: comment.body,
    createdAt: new Date(comment.createdAt),
  };
}
