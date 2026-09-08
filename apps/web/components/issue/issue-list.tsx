"use client";

import { type IssueStatus, statusLabels } from "@tracklane/domain";
import { Inbox, Plus } from "lucide-react";
import { useMemo } from "react";
import { TooltipIconButton } from "@/components/shell/tooltip-icon-button";
import { useWorkspaceUi } from "@/components/shell/workspace-ui";
import { Button } from "@/components/ui/button";
import { type IssueFilter, flattenGroups, groupIssueIds, groupsEqual, listStatuses } from "@/lib/issues";
import { useSelector } from "@/lib/sync/hooks";
import { EmptyState } from "./empty-state";
import { IssueRow } from "./issue-row";
import { StatusIcon } from "./status-icon";
import { useIssueNavigation } from "./use-issue-navigation";

interface IssueListProps {
  filter: IssueFilter;
  emptyTitle: string;
  emptyMessage: string;
  createTeamId?: string;
}

export function IssueList({ filter, emptyTitle, emptyMessage, createTeamId }: IssueListProps) {
  const ui = useWorkspaceUi();
  const groups = useSelector(["issue"], (pool) => groupIssueIds(pool, filter), groupsEqual);
  const ids = useMemo(() => flattenGroups(groups, listStatuses), [groups]);
  const nav = useIssueNavigation(ids);

  if (ids.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title={emptyTitle}
        action={
          <Button onClick={() => ui.openCreate(createTeamId ? { teamId: createTeamId } : undefined)}>
            <Plus strokeWidth={2} /> New issue
          </Button>
        }
      >
        {emptyMessage}
      </EmptyState>
    );
  }

  return (
    <div className="pb-24">
      {listStatuses
        .filter((status: IssueStatus) => groups[status].length > 0)
        .map((status) => (
          <section key={status} aria-labelledby={`group-${status}`}>
            <header className="sticky top-13 z-10 flex h-9 items-center gap-2 border-b border-border/60 bg-secondary/85 px-4 text-footnote font-medium backdrop-blur-xl sm:px-6 dark:bg-card/85">
              <StatusIcon status={status} />
              <h2 id={`group-${status}`}>{statusLabels[status]}</h2>
              <span className="text-muted-foreground tabular-nums">
                {groups[status].length}
                <span className="sr-only"> issues</span>
              </span>
              <TooltipIconButton
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                label={`New ${statusLabels[status]} issue`}
                onClick={() => ui.openCreate({ status, ...(createTeamId ? { teamId: createTeamId } : {}) })}
              >
                <Plus strokeWidth={2} />
              </TooltipIconButton>
            </header>
            <ul aria-labelledby={`group-${status}`}>
              {groups[status].map((id) => (
                <IssueRow
                  key={id}
                  issueId={id}
                  selected={nav.selectedId === id}
                  editing={nav.editingId === id}
                  openPicker={nav.pickerFor(id)}
                  onSelect={nav.setSelectedId}
                  onOpen={nav.onOpen}
                  onEditDone={nav.onEditDone}
                  onPickerChange={nav.onPickerChange}
                />
              ))}
            </ul>
          </section>
        ))}
    </div>
  );
}
