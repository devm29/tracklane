"use client";

import {
  type Issue,
  type IssueStatus,
  type Priority,
  allowedTransitions,
  issueStatuses,
  priorityLabels,
  statusLabels,
} from "@tracklane/domain";
import { FolderKanban } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { useCollection, useEntity } from "@/lib/sync/hooks";
import { useMutate } from "@/lib/sync/provider";
import { cn } from "@/lib/utils";
import { LabelPill, labelDot } from "./label-pill";
import { PriorityIcon } from "./priority-icon";
import { type PickerOption, PropertyPicker } from "./property-picker";
import { StatusIcon } from "./status-icon";
import { UserAvatar } from "./user-avatar";

const priorityOrder: readonly Priority[] = [1, 2, 3, 4, 0];

interface ControlledOpen {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tooltip?: string;
}

export function statusOptions(from?: IssueStatus): PickerOption<IssueStatus>[] {
  return issueStatuses.map((status, index) => {
    const allowed = !from || status === from || allowedTransitions(from).includes(status);
    return {
      value: status,
      label: statusLabels[status],
      icon: <StatusIcon status={status} />,
      disabled: !allowed,
      ...(allowed ? { shortcut: String(index + 1) } : { hint: "Not allowed" }),
    };
  });
}

export const priorityOptions: PickerOption<Priority>[] = priorityOrder.map((priority) => ({
  value: priority,
  label: priorityLabels[priority],
  icon: <PriorityIcon priority={priority} />,
  shortcut: String(priority),
}));

export function useAssigneeOptions(teamId: string): PickerOption<string | null>[] {
  const team = useEntity("team", teamId);
  const users = useCollection("user");
  return useMemo(() => {
    const members = users.filter((user) => team?.memberIds.includes(user.id));
    return [
      { value: null, label: "No assignee", icon: <UserAvatar user={undefined} size="xs" /> },
      ...members.map((user) => ({ value: user.id, label: user.name, icon: <UserAvatar user={user} size="xs" /> })),
    ];
  }, [team, users]);
}

export function useProjectOptions(teamId: string): PickerOption<string | null>[] {
  const projects = useCollection("project");
  return useMemo(
    () => [
      { value: null, label: "No project", icon: <FolderKanban className="text-muted-foreground" strokeWidth={1.75} /> },
      ...projects
        .filter((project) => project.teamId === teamId)
        .map((project) => ({
          value: project.id,
          label: project.name,
          icon: <FolderKanban className="text-primary" strokeWidth={1.75} />,
        })),
    ],
    [projects, teamId],
  );
}

export function useLabelOptions(): PickerOption<string>[] {
  const labels = useCollection("label");
  return useMemo(
    () =>
      labels.map((label) => ({
        value: label.id,
        label: label.name,
        icon: <span className={cn("ml-1 mr-0.5 size-2 rounded-full", labelDot[label.color])} />,
      })),
    [labels],
  );
}

export function PropertyButton({ className, children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-footnote transition-colors duration-150 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function IssueStatusPicker({ issue, children, ...open }: { issue: Issue; children: ReactNode } & ControlledOpen) {
  const mutate = useMutate();
  return (
    <PropertyPicker
      label="Change status"
      options={statusOptions(issue.status)}
      selected={[issue.status]}
      onSelect={(status) => status !== issue.status && mutate((client) => client.updateIssue(issue.id, { status }))}
      {...open}
    >
      {children}
    </PropertyPicker>
  );
}

export function IssuePriorityPicker({ issue, children, ...open }: { issue: Issue; children: ReactNode } & ControlledOpen) {
  const mutate = useMutate();
  return (
    <PropertyPicker
      label="Set priority"
      options={priorityOptions}
      selected={[issue.priority]}
      onSelect={(priority) => mutate((client) => client.updateIssue(issue.id, { priority }))}
      {...open}
    >
      {children}
    </PropertyPicker>
  );
}

export function IssueAssigneePicker({ issue, children, ...open }: { issue: Issue; children: ReactNode } & ControlledOpen) {
  const mutate = useMutate();
  const options = useAssigneeOptions(issue.teamId);
  return (
    <PropertyPicker
      label="Assign to"
      options={options}
      selected={[issue.assigneeId]}
      onSelect={(assigneeId) => mutate((client) => client.updateIssue(issue.id, { assigneeId }))}
      {...open}
    >
      {children}
    </PropertyPicker>
  );
}

export function IssueProjectPicker({ issue, children }: { issue: Issue; children: ReactNode }) {
  const mutate = useMutate();
  const options = useProjectOptions(issue.teamId);
  return (
    <PropertyPicker
      label="Move to project"
      options={options}
      selected={[issue.projectId]}
      onSelect={(projectId) => mutate((client) => client.updateIssue(issue.id, { projectId }))}
    >
      {children}
    </PropertyPicker>
  );
}

export function IssueLabelPicker({ issue, children }: { issue: Issue; children: ReactNode }) {
  const mutate = useMutate();
  const options = useLabelOptions();
  return (
    <PropertyPicker
      label="Add labels"
      options={options}
      selected={issue.labelIds}
      multiple
      onSelect={(labelId) => {
        const labelIds = issue.labelIds.includes(labelId)
          ? issue.labelIds.filter((id) => id !== labelId)
          : [...issue.labelIds, labelId];
        mutate((client) => client.updateIssue(issue.id, { labelIds }));
      }}
    >
      {children}
    </PropertyPicker>
  );
}

export function IssueLabels({ labelIds, max = 3 }: { labelIds: readonly string[]; max?: number }) {
  const labels = useCollection("label");
  const shown = labels.filter((label) => labelIds.includes(label.id));
  if (shown.length === 0) return null;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {shown.slice(0, max).map((label) => (
        <LabelPill key={label.id} label={label} />
      ))}
      {shown.length > max && <span className="text-caption2 text-muted-foreground">+{shown.length - max}</span>}
    </span>
  );
}
