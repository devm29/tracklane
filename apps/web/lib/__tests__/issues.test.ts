import type { Issue } from "@tracklane/domain";
import { ObjectPool } from "@tracklane/sync-core";
import { fixtureId, smallWorkspace } from "@tracklane/sync-core/testing";
import { describe, expect, it } from "vitest";
import { flattenGroups, groupIssueIds, groupsEqual, identifier, listStatuses, relativeTime } from "../issues";

const fixture = smallWorkspace();

function pool(issues: Issue[]): ObjectPool {
  const result = new ObjectPool();
  result.replaceConfirmed(issues.map((data) => ({ model: "issue" as const, data })));
  result.commit();
  return result;
}

describe("issue helpers", () => {
  it("shows a placeholder identifier until the server assigns a number", () => {
    expect(identifier({ number: 12 }, { key: "ENG" })).toBe("ENG-12");
    expect(identifier({ number: 0 }, { key: "ENG" })).toBe("ENG-…");
  });

  it("groups ids by status in sort order and hides archived issues", () => {
    const [a, b, c] = fixture.issues;
    if (!a || !b || !c) throw new Error("fixture issues missing");
    const issues = [
      { ...a, status: "in_progress" as const, sortOrder: 20 },
      { ...b, status: "in_progress" as const, sortOrder: 10 },
      { ...c, archivedAt: "2026-01-02T00:00:00.000Z" },
    ];
    const groups = groupIssueIds(pool(issues), {});
    expect(groups.in_progress).toEqual([b.id, a.id]);
    expect(flattenGroups(groups, listStatuses)).toEqual([b.id, a.id]);
  });

  it("treats groups with the same ids as equal so lists skip re-rendering", () => {
    const replica = pool(fixture.issues);
    expect(groupsEqual(groupIssueIds(replica, {}), groupIssueIds(replica, {}))).toBe(true);
    const other = pool([...fixture.issues, { ...fixture.issues[0], id: fixtureId(999) } as Issue]);
    expect(groupsEqual(groupIssueIds(replica, {}), groupIssueIds(other, {}))).toBe(false);
  });

  it("formats relative times compactly", () => {
    const now = Date.parse("2026-03-10T12:00:00.000Z");
    expect(relativeTime("2026-03-10T11:59:50.000Z", now)).toBe("just now");
    expect(relativeTime("2026-03-10T09:00:00.000Z", now)).toBe("3h ago");
    expect(relativeTime("2026-03-01T12:00:00.000Z", now)).toBe("9d ago");
  });
});
