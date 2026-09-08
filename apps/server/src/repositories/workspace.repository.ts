import type { Comment, Issue, Label, Project, Team, User, Workspace } from "@tracklane/domain";
import type { ClientSession } from "mongoose";
import { toComment, toIssue, toLabel, toProject, toTeam, toUser, toWorkspace } from "../db/mappers.js";
import type { CommentDoc, IssueDoc, LabelDoc, Models, ProjectDoc, TeamDoc, UserDoc, WorkspaceDoc } from "../db/models.js";

export interface WorkspaceSnapshot {
  workspace: Workspace;
  users: User[];
  teams: Team[];
  projects: Project[];
  labels: Label[];
  issues: Issue[];
  comments: Comment[];
}

export interface IssuePageQuery {
  workspaceId: string;
  teamIds: readonly string[];
  limit: number;
  cursor: { updatedAt: Date; id: string } | null;
}

export class WorkspaceRepository {
  constructor(private readonly models: Models) {}

  async findWorkspace(workspaceId: string): Promise<Workspace | null> {
    const doc = await this.models.Workspace.findById(workspaceId).lean<WorkspaceDoc>();
    return doc ? toWorkspace(doc) : null;
  }

  async findBySlug(slug: string): Promise<Workspace | null> {
    const doc = await this.models.Workspace.findOne({ slug }).lean<WorkspaceDoc>();
    return doc ? toWorkspace(doc) : null;
  }

  async listTeams(workspaceId: string, session?: ClientSession): Promise<Team[]> {
    const docs = await this.models.Team.find({ workspaceId })
      .sort({ name: 1 })
      .session(session ?? null)
      .lean<TeamDoc[]>();
    return docs.map(toTeam);
  }

  async findIssueTeamId(workspaceId: string, issueId: string): Promise<string | null> {
    const doc = await this.models.Issue.findOne({ _id: issueId, workspaceId }, { teamId: 1 }).lean<Pick<IssueDoc, "teamId">>();
    return doc?.teamId ?? null;
  }

  /** Reads everything a replica needs, scoped to the given teams. Call inside a snapshot transaction for a consistent cut. */
  async snapshot(workspaceId: string, teamIds: readonly string[], session: ClientSession): Promise<WorkspaceSnapshot> {
    const scoped = { workspaceId, teamId: { $in: teamIds } };
    const workspace = await this.models.Workspace.findById(workspaceId).session(session).lean<WorkspaceDoc>();
    if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);
    const users = await this.models.User.find({ workspaceId }).sort({ name: 1 }).session(session).lean<UserDoc[]>();
    const teams = await this.models.Team.find({ workspaceId, _id: { $in: teamIds } }).sort({ name: 1 }).session(session).lean<TeamDoc[]>();
    const projects = await this.models.Project.find(scoped).sort({ name: 1 }).session(session).lean<ProjectDoc[]>();
    const labels = await this.models.Label.find({ workspaceId }).sort({ name: 1 }).session(session).lean<LabelDoc[]>();
    const issues = await this.models.Issue.find(scoped).session(session).lean<IssueDoc[]>();
    const comments = await this.models.Comment.find(scoped).sort({ createdAt: 1 }).session(session).lean<CommentDoc[]>();
    return {
      workspace: toWorkspace(workspace),
      users: users.map(toUser),
      teams: teams.map(toTeam),
      projects: projects.map(toProject),
      labels: labels.map(toLabel),
      issues: issues.map(toIssue),
      comments: comments.map(toComment),
    };
  }

  async pageIssues(query: IssuePageQuery): Promise<Issue[]> {
    const filter: Record<string, unknown> = { workspaceId: query.workspaceId, teamId: { $in: query.teamIds } };
    if (query.cursor) {
      filter.$or = [
        { updatedAt: { $lt: query.cursor.updatedAt } },
        { updatedAt: query.cursor.updatedAt, _id: { $lt: query.cursor.id } },
      ];
    }
    const docs = await this.models.Issue.find(filter)
      .sort({ updatedAt: -1, _id: -1 })
      .limit(query.limit)
      .lean<IssueDoc[]>();
    return docs.map(toIssue);
  }
}
