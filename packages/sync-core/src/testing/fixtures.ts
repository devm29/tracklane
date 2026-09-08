import type { Issue, Label, Team, User, Workspace } from "@tracklane/domain";
import type { InMemoryServerSeed } from "./in-memory-server.js";

export function fixtureId(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function sequentialIds(start = 10_000): () => string {
  let next = start;
  return () => fixtureId(next++);
}

export interface Fixture extends InMemoryServerSeed {
  users: User[];
  teams: Team[];
  issues: Issue[];
  labels: Label[];
}

/**
 * Two teams, three people. Ada and Grace share "Core", Linus is only on
 * "Web" and Ada is an admin, so the fixture exercises team-scoped visibility.
 */
export function smallWorkspace(): Fixture {
  const workspace: Workspace = { id: fixtureId(1), name: "Fixture", slug: "fixture" };
  const user = (n: number, name: string, role: User["role"]): User => ({
    id: fixtureId(n),
    workspaceId: workspace.id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    role,
    avatarHue: n * 40,
  });
  const ada = user(10, "Ada", "admin");
  const grace = user(11, "Grace", "member");
  const linus = user(12, "Linus", "member");
  const core: Team = { id: fixtureId(20), workspaceId: workspace.id, key: "CORE", name: "Core", memberIds: [ada.id, grace.id] };
  const web: Team = { id: fixtureId(21), workspaceId: workspace.id, key: "WEB", name: "Web", memberIds: [ada.id, linus.id] };
  const labels: Label[] = [
    { id: fixtureId(30), workspaceId: workspace.id, name: "Bug", color: "red" },
    { id: fixtureId(31), workspaceId: workspace.id, name: "Feature", color: "blue" },
  ];
  const createdAt = "2026-01-01T00:00:00.000Z";
  const issue = (n: number, team: Team, number: number, title: string): Issue => ({
    id: fixtureId(n),
    workspaceId: workspace.id,
    teamId: team.id,
    projectId: null,
    number,
    title,
    description: "",
    status: "todo",
    priority: 0,
    assigneeId: null,
    creatorId: ada.id,
    labelIds: [],
    sortOrder: number * 1024,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
  });
  return {
    workspace,
    users: [ada, grace, linus],
    teams: [core, web],
    labels,
    projects: [],
    issues: [issue(100, core, 1, "Sync engine"), issue(101, core, 2, "Offline outbox"), issue(102, web, 1, "Board view")],
    comments: [],
  };
}
