import type { IssueStatus } from "@tracklane/domain";
import { describe, expect, it } from "vitest";
import { type Columns, columnId, containerOf, moveAcross, resolveDrop } from "../board";

function columns(overrides: Partial<Columns>): Columns {
  return { backlog: [], todo: [], in_progress: [], in_review: [], done: [], canceled: [], ...overrides };
}

const orders: Record<string, number> = { a: 1_000, b: 2_000, c: 3_000, x: 1_500 };
const sortOrderOf = (id: string): number | undefined => orders[id];

describe("board drag and drop", () => {
  it("finds the column for a card or a column id", () => {
    const board = columns({ todo: ["a"] });
    expect(containerOf("a", board)).toBe("todo");
    expect(containerOf(columnId("done"), board)).toBe("done");
    expect(containerOf("column:nonsense", board)).toBeUndefined();
  });

  it("previews a move into an allowed column and refuses a forbidden one", () => {
    const board = columns({ backlog: ["a"], todo: ["b"] });
    const moved = moveAcross(board, "a", "b", "backlog");
    expect(moved.backlog).toEqual([]);
    expect(moved.todo).toEqual(["a", "b"]);
    expect(moveAcross(board, "a", columnId("done"), "backlog")).toBe(board);
  });

  it("reorders within a column by placing the card between its new neighbours", () => {
    const original = columns({ todo: ["a", "b", "c"] });
    const outcome = resolveDrop({
      moving: "a",
      overId: "c",
      columns: original,
      original,
      currentStatus: "todo",
      sortOrderOf,
    });
    expect(outcome.kind).toBe("update");
    if (outcome.kind !== "update") return;
    expect(outcome.patch.status).toBeUndefined();
    expect(outcome.patch.sortOrder).toBeGreaterThan(3_000);
  });

  it("changes status when the card lands in another column", () => {
    const original = columns({ todo: ["x"], in_progress: ["a", "b"] });
    const preview = moveAcross(original, "x", "b", "todo");
    const outcome = resolveDrop({ moving: "x", overId: "x", columns: preview, original, currentStatus: "todo", sortOrderOf });
    expect(outcome.kind).toBe("update");
    if (outcome.kind !== "update") return;
    expect(outcome.patch.status).toBe("in_progress");
    expect(outcome.patch.sortOrder).toBeGreaterThan(1_000);
    expect(outcome.patch.sortOrder).toBeLessThan(2_000);
  });

  it("reports a forbidden transition instead of writing", () => {
    const original = columns({ backlog: ["a"] });
    const status: IssueStatus = "backlog";
    expect(
      resolveDrop({ moving: "a", overId: columnId("done"), columns: original, original, currentStatus: status, sortOrderOf }),
    ).toEqual({ kind: "forbidden", from: "backlog", to: "done" });
  });

  it("does nothing when the card is dropped where it started", () => {
    const original = columns({ todo: ["a", "b"] });
    expect(resolveDrop({ moving: "a", overId: "a", columns: original, original, currentStatus: "todo", sortOrderOf })).toEqual({
      kind: "none",
    });
  });
});
