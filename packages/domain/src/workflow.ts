import type { IssueStatus, Priority } from "./entities.js";

const transitions: Readonly<Record<IssueStatus, readonly IssueStatus[]>> = {
  backlog: ["todo", "in_progress", "canceled"],
  todo: ["backlog", "in_progress", "done", "canceled"],
  in_progress: ["todo", "in_review", "done", "canceled"],
  in_review: ["in_progress", "done", "canceled"],
  done: ["todo", "in_progress"],
  canceled: ["backlog", "todo"],
};

export function canTransition(from: IssueStatus, to: IssueStatus): boolean {
  return from === to || transitions[from].includes(to);
}

export function allowedTransitions(from: IssueStatus): readonly IssueStatus[] {
  return transitions[from];
}

export const statusLabels: Readonly<Record<IssueStatus, string>> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  canceled: "Canceled",
};

export const priorityLabels: Readonly<Record<Priority, string>> = {
  0: "No priority",
  1: "Urgent",
  2: "High",
  3: "Medium",
  4: "Low",
};

export function isClosed(status: IssueStatus): boolean {
  return status === "done" || status === "canceled";
}
