import { type Issue, type IssueStatus, type Team, issueStatuses } from "@tracklane/domain";
import type { ObjectPool } from "@tracklane/sync-core";

export const boardStatuses: readonly IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "done"];
export const listStatuses: readonly IssueStatus[] = ["in_review", "in_progress", "todo", "backlog", "done", "canceled"];

export function identifier(issue: Pick<Issue, "number">, team: Pick<Team, "key"> | undefined): string {
  const key = team?.key ?? "…";
  return issue.number > 0 ? `${key}-${issue.number}` : `${key}-…`;
}

export function compareIssues(a: Issue, b: Issue): number {
  return a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

export interface IssueFilter {
  teamId?: string;
  assigneeId?: string;
  includeArchived?: boolean;
}

export function matchesFilter(issue: Issue, filter: IssueFilter): boolean {
  if (!filter.includeArchived && issue.archivedAt) return false;
  if (filter.teamId && issue.teamId !== filter.teamId) return false;
  if (filter.assigneeId && issue.assigneeId !== filter.assigneeId) return false;
  return true;
}

export type IssueGroups = Record<IssueStatus, string[]>;

function emptyGroups(): IssueGroups {
  return Object.fromEntries(issueStatuses.map((status) => [status, [] as string[]])) as IssueGroups;
}

/** Ids grouped by status, each group in display order. Selecting ids keeps list re-renders cheap. */
export function groupIssueIds(pool: ObjectPool, filter: IssueFilter): IssueGroups {
  const groups = emptyGroups();
  const issues = pool.all("issue").filter((issue) => matchesFilter(issue, filter)).sort(compareIssues);
  for (const issue of issues) groups[issue.status].push(issue.id);
  return groups;
}

export function groupsEqual(a: IssueGroups, b: IssueGroups): boolean {
  return issueStatuses.every((status) => {
    const left = a[status];
    const right = b[status];
    return left.length === right.length && left.every((id, index) => id === right[index]);
  });
}

export function flattenGroups(groups: IssueGroups, order: readonly IssueStatus[]): string[] {
  return order.flatMap((status) => groups[status]);
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
