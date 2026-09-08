import { createHash, randomUUID } from "node:crypto";
import { type Models, clearModels } from "../db/models.js";
import { issueCounterKey, syncCounterKey } from "../repositories/counter.repository.js";
import { hashPassword } from "../services/auth.service.js";
import * as demo from "./demo-data.js";

/** Stable UUIDs derived from a name, so reseeding keeps links and test fixtures valid. */
export function stableId(name: string): string {
  const hex = createHash("sha256").update(`tracklane:${name}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`;
}

export interface SeedSummary {
  workspaceId: string;
  users: number;
  issues: number;
  comments: number;
}

function lookup(map: Map<string, string>, key: string): string {
  const value = map.get(key);
  if (!value) throw new Error(`Seed data references unknown key "${key}"`);
  return value;
}

export async function seedDemoWorkspace(models: Models, now = new Date()): Promise<SeedSummary> {
  const workspaceId = stableId(`workspace:${demo.workspace.slug}`);
  const userIds = new Map(demo.users.map((user) => [user.key, stableId(`user:${user.key}`)]));
  const teamIds = new Map(demo.teams.map((team) => [team.key, stableId(`team:${team.key}`)]));
  const labelIds = new Map(demo.labels.map((label) => [label.key, stableId(`label:${label.key}`)]));
  const projectIds = new Map(demo.projects.map((project) => [project.key, stableId(`project:${project.key}`)]));

  await clearModels(models);

  const passwordHash = await hashPassword(demo.DEMO_PASSWORD);
  await models.Workspace.create({ _id: workspaceId, ...demo.workspace });
  await models.User.insertMany(
    demo.users.map((user) => ({
      _id: lookup(userIds, user.key),
      workspaceId,
      name: user.name,
      email: user.email,
      role: user.role,
      avatarHue: user.avatarHue,
      passwordHash,
    })),
  );
  await models.Team.insertMany(
    demo.teams.map((team) => ({
      _id: lookup(teamIds, team.key),
      workspaceId,
      key: team.key,
      name: team.name,
      memberIds: team.members.map((member) => lookup(userIds, member)),
    })),
  );
  await models.Label.insertMany(
    demo.labels.map((label) => ({ _id: lookup(labelIds, label.key), workspaceId, name: label.name, color: label.color })),
  );
  await models.Project.insertMany(
    demo.projects.map((project) => ({
      _id: lookup(projectIds, project.key),
      workspaceId,
      teamId: lookup(teamIds, project.team),
      name: project.name,
      description: project.description,
      status: project.status,
      targetDate: project.targetDate ? new Date(`${project.targetDate}T00:00:00.000Z`) : null,
    })),
  );

  const hour = 60 * 60 * 1000;
  let issueCount = 0;
  let commentCount = 0;
  for (const [teamKey, teamIssues] of Object.entries(demo.issues)) {
    const teamId = lookup(teamIds, teamKey);
    const docs = teamIssues.map((issue, index) => {
      const number = index + 1;
      const createdAt = new Date(now.getTime() - (teamIssues.length - index) * 26 * hour);
      const updatedAt = new Date(Math.min(now.getTime() - index * hour, createdAt.getTime() + 20 * hour));
      return {
        _id: stableId(`issue:${teamKey}-${number}`),
        workspaceId,
        teamId,
        projectId: issue.project ? lookup(projectIds, issue.project) : null,
        number,
        title: issue.title,
        description: issue.description ?? "",
        status: issue.status,
        priority: issue.priority,
        assigneeId: issue.assignee ? lookup(userIds, issue.assignee) : null,
        creatorId: lookup(userIds, issue.assignee ?? "maya"),
        labelIds: issue.labels.map((label) => lookup(labelIds, label)),
        sortOrder: number * 1024,
        createdAt,
        updatedAt,
        archivedAt: null,
      };
    });
    await models.Issue.insertMany(docs);
    issueCount += docs.length;

    const comments = teamIssues.flatMap((issue, index) =>
      (issue.comments ?? []).map(([author, body], position) => {
        const parent = docs[index];
        if (!parent) throw new Error("Seed issue missing");
        return {
          _id: stableId(`comment:${teamKey}-${index + 1}-${position}`),
          workspaceId,
          teamId,
          issueId: parent._id,
          authorId: lookup(userIds, author),
          body,
          createdAt: new Date(parent.createdAt.getTime() + (position + 1) * 3 * hour),
        };
      }),
    );
    if (comments.length > 0) await models.Comment.insertMany(comments);
    commentCount += comments.length;
    await models.Counter.create({ _id: issueCounterKey(teamId), value: docs.length });
  }
  // A fresh epoch tells replicas seeded from the previous data that their cursor is meaningless now.
  await models.Counter.create({ _id: syncCounterKey(workspaceId), value: 0, epoch: randomUUID() });

  return { workspaceId, users: demo.users.length, issues: issueCount, comments: commentCount };
}
