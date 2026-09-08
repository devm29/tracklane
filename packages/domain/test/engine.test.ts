import { describe, expect, it } from "vitest";
import {
  type EntityReader,
  type ExecuteOptions,
  type Issue,
  type ModelMap,
  type ModelName,
  type Mutation,
  type Team,
  canTransition,
  executeMutation,
  referencedEntities,
  sortOrderBetween,
} from "../src/index.js";

const id = (n: number): string => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const workspaceId = id(1);
const ada = id(10);
const grace = id(11);
const outsider = id(12);
const team: Team = { id: id(20), workspaceId, key: "CORE", name: "Core", memberIds: [ada, grace] };
const otherTeam: Team = { id: id(21), workspaceId, key: "WEB", name: "Web", memberIds: [outsider] };
const issue: Issue = {
  id: id(100),
  workspaceId,
  teamId: team.id,
  projectId: null,
  number: 1,
  title: "Sync engine",
  description: "",
  status: "todo",
  priority: 0,
  assigneeId: null,
  creatorId: ada,
  labelIds: [],
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
};

function reader(extra: Partial<Record<ModelName, Record<string, unknown>>> = {}): EntityReader {
  const tables: Partial<Record<ModelName, Record<string, unknown>>> = {
    team: { [team.id]: team, [otherTeam.id]: otherTeam },
    issue: { [issue.id]: issue },
    project: { [id(40)]: { id: id(40), workspaceId, teamId: otherTeam.id, name: "Elsewhere", description: "", status: "planned", targetDate: null } },
    ...extra,
  };
  return {
    get: <M extends ModelName>(model: M, key: string) => tables[model]?.[key] as ModelMap[M] | undefined,
  };
}

const options = (userId = ada, role: "admin" | "member" = "member"): ExecuteOptions => ({
  actor: { userId, workspaceId, role },
  now: "2026-02-01T00:00:00.000Z",
  allocateIssueNumber: () => 42,
});

describe("executeMutation", () => {
  it("creates issues with a server-allocated number", () => {
    const mutation: Mutation = {
      kind: "issue.create",
      id: id(101),
      input: {
        teamId: team.id,
        title: "Board view",
        description: "",
        status: "backlog",
        priority: 2,
        assigneeId: grace,
        projectId: null,
        labelIds: [],
        sortOrder: 10,
      },
    };
    const result = executeMutation(reader(), mutation, options());
    expect(result.ok && result.write?.data).toMatchObject({ number: 42, creatorId: ada, title: "Board view" });
  });

  it("merges patches field by field and reports what changed", () => {
    const result = executeMutation(reader(), { kind: "issue.update", id: issue.id, patch: { title: "Renamed", priority: 0 } }, options());
    expect(result.ok).toBe(true);
    if (!result.ok || result.write?.model !== "issue") return;
    expect(result.write.changedFields).toEqual(["title"]);
    expect(result.write.data).toMatchObject({ title: "Renamed", status: "todo", updatedAt: "2026-02-01T00:00:00.000Z" });
  });

  it("treats a patch that changes nothing as a no-op", () => {
    const result = executeMutation(
      reader(),
      { kind: "issue.update", id: issue.id, patch: { priority: issue.priority, title: issue.title } },
      options(),
    );
    expect(result).toEqual({ ok: true, write: null });
  });

  it("rejects invalid workflow transitions", () => {
    const backlog = { ...issue, status: "backlog" as const };
    const result = executeMutation(
      reader({ issue: { [issue.id]: backlog } }),
      { kind: "issue.update", id: issue.id, patch: { status: "done" } },
      options(),
    );
    expect(result).toMatchObject({ ok: false, rejection: { code: "invalid_transition" } });
  });

  it("enforces team membership unless the actor is an admin", () => {
    const update: Mutation = { kind: "issue.update", id: issue.id, patch: { priority: 1 } };
    expect(executeMutation(reader(), update, options(outsider))).toMatchObject({ ok: false, rejection: { code: "forbidden" } });
    expect(executeMutation(reader(), update, options(outsider, "admin")).ok).toBe(true);
  });

  it("validates references against the issue's team", () => {
    const assign = executeMutation(reader(), { kind: "issue.update", id: issue.id, patch: { assigneeId: outsider } }, options());
    expect(assign).toMatchObject({ ok: false, rejection: { code: "validation" } });
    const project = executeMutation(reader(), { kind: "issue.update", id: issue.id, patch: { projectId: id(40) } }, options());
    expect(project).toMatchObject({ ok: false, rejection: { code: "validation" } });
  });

  it("refuses edits and comments on archived issues", () => {
    const archived = reader({ issue: { [issue.id]: { ...issue, archivedAt: "2026-01-02T00:00:00.000Z" } } });
    expect(executeMutation(archived, { kind: "issue.update", id: issue.id, patch: { title: "x" } }, options())).toMatchObject({
      ok: false,
      rejection: { code: "archived" },
    });
    expect(
      executeMutation(archived, { kind: "comment.create", id: id(300), input: { issueId: issue.id, body: "hi" } }, options()),
    ).toMatchObject({ ok: false, rejection: { code: "archived" } });
    expect(executeMutation(archived, { kind: "issue.unarchive", id: issue.id }, options()).ok).toBe(true);
  });

  it("only lets authors delete their comments", () => {
    const comment = { id: id(300), workspaceId, teamId: team.id, issueId: issue.id, authorId: grace, body: "hi", createdAt: issue.createdAt };
    const withComment = reader({ comment: { [comment.id]: comment } });
    expect(executeMutation(withComment, { kind: "comment.delete", id: comment.id }, options(ada))).toMatchObject({
      ok: false,
      rejection: { code: "forbidden" },
    });
    expect(executeMutation(withComment, { kind: "comment.delete", id: comment.id }, options(grace)).ok).toBe(true);
  });
});

describe("referencedEntities", () => {
  it("discovers the team only once the issue is known", () => {
    const mutation: Mutation = { kind: "issue.update", id: issue.id, patch: { priority: 1 } };
    const empty: EntityReader = { get: () => undefined };
    expect(referencedEntities(mutation, empty)).toEqual([{ model: "issue", id: issue.id }]);
    expect(referencedEntities(mutation, reader())).toContainEqual({ model: "team", id: team.id });
  });
});

describe("workflow and ordering", () => {
  it("allows staying put and forbids skipping triage", () => {
    expect(canTransition("todo", "todo")).toBe(true);
    expect(canTransition("backlog", "done")).toBe(false);
    expect(canTransition("in_review", "done")).toBe(true);
  });

  it("places new items between neighbours", () => {
    expect(sortOrderBetween(undefined, undefined)).toBe(0);
    expect(sortOrderBetween(10, 20)).toBe(15);
    expect(sortOrderBetween(undefined, 0)).toBeLessThan(0);
    expect(sortOrderBetween(0, undefined)).toBeGreaterThan(0);
  });
});
