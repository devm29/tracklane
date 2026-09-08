"use client";

import { TITLE_MAX_LENGTH } from "@tracklane/domain";
import Link from "next/link";
import { memo, useRef, useState } from "react";
import { identifier } from "@/lib/issues";
import { useEntity } from "@/lib/sync/hooks";
import { useMutate } from "@/lib/sync/provider";
import { cn } from "@/lib/utils";
import { IssueAssigneePicker, IssueLabels, IssuePriorityPicker, IssueStatusPicker } from "./pickers";
import { PriorityIcon } from "./priority-icon";
import { RelativeTime } from "./relative-time";
import { StatusIcon } from "./status-icon";
import { UserAvatar } from "./user-avatar";

export type RowPicker = "status" | "assignee" | "priority";

interface IssueRowProps {
  issueId: string;
  selected: boolean;
  editing: boolean;
  openPicker: RowPicker | null;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onEditDone: () => void;
  onPickerChange: (id: string, picker: RowPicker | null) => void;
}

function InlineTitle({ issueId, title, onDone }: { issueId: string; title: string; onDone: () => void }) {
  const mutate = useMutate();
  const [value, setValue] = useState(title);
  // Enter commits, then unmounting blurs the input; Escape cancels, then the same blur would commit.
  // Whichever comes first settles the edit and the rest are ignored.
  const settled = useRef(false);
  const finish = (save: boolean): void => {
    if (settled.current) return;
    settled.current = true;
    const next = value.trim();
    if (save && next && next !== title) mutate((client) => client.updateIssue(issueId, { title: next }));
    onDone();
  };
  return (
    <input
      autoFocus
      aria-label="Issue title"
      value={value}
      maxLength={TITLE_MAX_LENGTH}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(true);
        if (event.key === "Escape") finish(false);
      }}
      className="h-7 min-w-0 flex-1 rounded-md bg-background px-1.5 text-body-sm ring-4 ring-ring outline-none"
    />
  );
}

/**
 * Subscribes to its own issue, so a remote edit re-renders this row only.
 * The list above it re-renders only when ids move between groups.
 */
export const IssueRow = memo(function IssueRow({
  issueId,
  selected,
  editing,
  openPicker,
  onSelect,
  onOpen,
  onEditDone,
  onPickerChange,
}: IssueRowProps) {
  const issue = useEntity("issue", issueId);
  const team = useEntity("team", issue?.teamId);
  const assignee = useEntity("user", issue?.assigneeId);
  const project = useEntity("project", issue?.projectId);
  if (!issue) return null;

  const pickerProps = (kind: RowPicker, tooltip: string) => ({
    open: openPicker === kind,
    onOpenChange: (open: boolean) => onPickerChange(issueId, open ? kind : null),
    tooltip,
  });
  const iconButton = "hit-area flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none";

  return (
    <li
      aria-current={selected ? "true" : undefined}
      data-selected={selected}
      data-issue-id={issueId}
      data-testid="issue-row"
      onClick={() => onOpen(issueId)}
      onMouseMove={() => !selected && onSelect(issueId)}
      className="group flex h-11 cursor-default items-center gap-3 border-b border-border/60 px-4 transition-colors duration-100 hover:bg-accent/50 data-[selected=true]:bg-primary/10 sm:px-6"
    >
      <IssuePriorityPicker issue={issue} {...pickerProps("priority", "Set priority")}>
        <button type="button" aria-label="Set priority" onClick={(event) => event.stopPropagation()} className={iconButton}>
          <PriorityIcon priority={issue.priority} />
        </button>
      </IssuePriorityPicker>
      <span className="hidden w-14 shrink-0 text-caption text-muted-foreground tabular-nums sm:block">{identifier(issue, team)}</span>
      <IssueStatusPicker issue={issue} {...pickerProps("status", "Change status")}>
        <button type="button" aria-label="Change status" onClick={(event) => event.stopPropagation()} className={iconButton}>
          <StatusIcon status={issue.status} />
        </button>
      </IssueStatusPicker>
      {editing ? (
        <InlineTitle issueId={issueId} title={issue.title} onDone={onEditDone} />
      ) : (
        <Link
          href={`/issue/${issueId}`}
          onClick={(event) => event.stopPropagation()}
          onFocus={() => !selected && onSelect(issueId)}
          className={cn(
            "min-w-0 flex-1 truncate rounded-sm text-body-sm outline-none focus-visible:ring-4 focus-visible:ring-ring",
            issue.status === "canceled" && "text-muted-foreground line-through",
          )}
          data-testid="issue-title"
        >
          {issue.title}
        </Link>
      )}
      <span className="hidden lg:flex">
        <IssueLabels labelIds={issue.labelIds} max={2} />
      </span>
      {project && <span className="hidden max-w-36 truncate text-caption text-muted-foreground xl:block">{project.name}</span>}
      <IssueAssigneePicker issue={issue} {...pickerProps("assignee", assignee ? `Assigned to ${assignee.name}` : "Assign")}>
        <button type="button" aria-label="Assign" onClick={(event) => event.stopPropagation()} className={cn(iconButton, "rounded-full")}>
          <UserAvatar user={assignee} size="xs" />
        </button>
      </IssueAssigneePicker>
      <RelativeTime value={issue.updatedAt} className="hidden w-16 shrink-0 text-right text-caption text-muted-foreground tabular-nums md:block" />
    </li>
  );
});
