import { type IssuePatch, type IssueStatus, canTransition, issueStatuses, sortOrderBetween } from "@tracklane/domain";
import type { IssueGroups } from "./issues";

export type Columns = Record<IssueStatus, string[]>;

const COLUMN_PREFIX = "column:";

export const columnId = (status: IssueStatus): string => `${COLUMN_PREFIX}${status}`;

export function toColumns(groups: IssueGroups): Columns {
  const copy = (status: IssueStatus): string[] => [...groups[status]];
  return {
    backlog: copy("backlog"),
    todo: copy("todo"),
    in_progress: copy("in_progress"),
    in_review: copy("in_review"),
    done: copy("done"),
    canceled: copy("canceled"),
  };
}

/** The column a draggable or droppable id belongs to: either a column itself or a card inside one. */
export function containerOf(id: string, columns: Columns): IssueStatus | undefined {
  if (id.startsWith(COLUMN_PREFIX)) {
    const status = id.slice(COLUMN_PREFIX.length);
    return issueStatuses.find((candidate) => candidate === status);
  }
  return issueStatuses.find((status) => columns[status].includes(id));
}

/** Live preview while dragging across columns; returns the same object when the move isn't allowed. */
export function moveAcross(columns: Columns, moving: string, overId: string, currentStatus: IssueStatus): Columns {
  const from = containerOf(moving, columns);
  const to = containerOf(overId, columns);
  if (!from || !to || from === to || !canTransition(currentStatus, to)) return columns;
  const target = columns[to].filter((id) => id !== moving);
  const overIndex = target.indexOf(overId);
  target.splice(overIndex === -1 ? target.length : overIndex, 0, moving);
  return { ...columns, [from]: columns[from].filter((id) => id !== moving), [to]: target };
}

export type DropOutcome =
  | { kind: "none" }
  | { kind: "forbidden"; from: IssueStatus; to: IssueStatus }
  | { kind: "update"; patch: IssuePatch };

export interface DropInput {
  moving: string;
  overId: string;
  /** Columns as previewed during the drag. */
  columns: Columns;
  /** Columns as they were before the drag started. */
  original: IssueGroups;
  currentStatus: IssueStatus;
  sortOrderOf: (id: string) => number | undefined;
}

/**
 * Turns a finished drag into at most one issue update: a new status when the
 * card changed columns, and a sortOrder between its new neighbours.
 */
export function resolveDrop({ moving, overId, columns, original, currentStatus, sortOrderOf }: DropInput): DropOutcome {
  const overStatus = containerOf(overId, columns);
  if (overStatus && overStatus !== currentStatus && !canTransition(currentStatus, overStatus)) {
    return { kind: "forbidden", from: currentStatus, to: overStatus };
  }

  const status = containerOf(moving, columns) ?? currentStatus;
  const column = [...columns[status]];
  const from = column.indexOf(moving);
  const overIndex = column.indexOf(overId);
  if (overIndex !== -1 && from !== -1 && overIndex !== from) {
    column.splice(from, 1);
    column.splice(overIndex, 0, moving);
  }
  const index = column.indexOf(moving);
  const before = column[index - 1];
  const after = column[index + 1];
  const moved = status !== currentStatus;
  if (!moved && original[status].indexOf(moving) === index) return { kind: "none" };

  const sortOrder = sortOrderBetween(before ? sortOrderOf(before) : undefined, after ? sortOrderOf(after) : undefined);
  return { kind: "update", patch: { ...(moved ? { status } : {}), sortOrder } };
}
