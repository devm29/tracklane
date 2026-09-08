import { describe, expect, it, vi } from "vitest";
import { ObjectPool, entityKey } from "../src/index.js";
import { smallWorkspace } from "../src/testing/index.js";
import { must } from "./helpers.js";

const fixture = smallWorkspace();
const first = must(fixture.issues[0], "first issue");
const second = must(fixture.issues[1], "second issue");

function seededPool(): ObjectPool {
  const pool = new ObjectPool();
  pool.replaceConfirmed(fixture.issues.map((data) => ({ model: "issue" as const, data })));
  pool.commit();
  return pool;
}

describe("ObjectPool", () => {
  it("layers the optimistic overlay over confirmed state", () => {
    const pool = seededPool();
    pool.setOverlay(new Map([[entityKey("issue", first.id), { ...first, title: "Optimistic" }]]));
    pool.commit();
    expect(pool.get("issue", first.id)?.title).toBe("Optimistic");
    expect(pool.getConfirmed("issue", first.id)?.title).toBe(first.title);

    pool.setOverlay(new Map());
    pool.commit();
    expect(pool.get("issue", first.id)?.title).toBe(first.title);
  });

  it("treats a null overlay entry as an optimistic removal", () => {
    const pool = seededPool();
    pool.setOverlay(new Map([[entityKey("issue", first.id), null]]));
    pool.commit();
    expect(pool.get("issue", first.id)).toBeUndefined();
    expect(pool.all("issue")).toHaveLength(fixture.issues.length - 1);
  });

  it("keeps object identity for structurally equal entities and only notifies changed keys", () => {
    const pool = seededPool();
    const before = pool.get("issue", second.id);
    const firstListener = vi.fn();
    const secondListener = vi.fn();
    pool.subscribeEntity("issue", first.id, firstListener);
    pool.subscribeEntity("issue", second.id, secondListener);

    pool.upsertConfirmed({ model: "issue", data: { ...second, labelIds: [...second.labelIds] } });
    pool.upsertConfirmed({ model: "issue", data: { ...first, priority: 1 } });
    const changed = pool.commit();

    expect([...changed]).toEqual([entityKey("issue", first.id)]);
    expect(pool.get("issue", second.id)).toBe(before);
    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).not.toHaveBeenCalled();
  });

  it("caches collection snapshots until the model changes", () => {
    const pool = seededPool();
    const list = pool.all("issue");
    expect(pool.all("issue")).toBe(list);
    pool.upsertConfirmed({ model: "issue", data: { ...first, title: "Renamed" } });
    pool.commit();
    expect(pool.all("issue")).not.toBe(list);
  });
});
