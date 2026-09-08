"use client";

import {
  type CollisionDetection,
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { type IssueStatus, canTransition, statusLabels } from "@tracklane/domain";
import { Plus } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { toast } from "sonner";
import { useWorkspaceUi } from "@/components/shell/workspace-ui";
import { TooltipIconButton } from "@/components/shell/tooltip-icon-button";
import { type Columns, columnId, moveAcross, resolveDrop, toColumns } from "@/lib/board";
import { boardStatuses, flattenGroups, groupIssueIds, groupsEqual, identifier } from "@/lib/issues";
import { useEntity, useSelector } from "@/lib/sync/hooks";
import { useMutate, useSyncClient } from "@/lib/sync/provider";
import { cn } from "@/lib/utils";
import { IssueLabels } from "./pickers";
import { PriorityIcon } from "./priority-icon";
import { StatusIcon } from "./status-icon";
import { useIssueNavigation } from "./use-issue-navigation";
import { UserAvatar } from "./user-avatar";


const CardBody = memo(function CardBody({ issueId, lifted = false }: { issueId: string; lifted?: boolean }) {
  const issue = useEntity("issue", issueId);
  const team = useEntity("team", issue?.teamId);
  const assignee = useEntity("user", issue?.assigneeId);
  if (!issue) return null;
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border border-border/60 bg-card p-3 shadow-xs transition-shadow duration-150",
        lifted && "rotate-[1.5deg] shadow-lg",
      )}
    >
      <div className="flex items-center gap-2 text-caption text-muted-foreground">
        <span className="tabular-nums">{identifier(issue, team)}</span>
        <UserAvatar user={assignee} size="xs" className="ml-auto" />
      </div>
      <p className="line-clamp-2 text-body-sm leading-5 font-medium" data-testid="board-card-title">
        {issue.title}
      </p>
      <div className="flex items-center gap-1.5">
        <PriorityIcon priority={issue.priority} />
        <IssueLabels labelIds={issue.labelIds} max={2} />
      </div>
    </div>
  );
});

function SortableCard({ issueId, selected, onOpen }: { issueId: string; selected: boolean; onOpen: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issueId });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-issue-id={issueId}
      data-testid="board-card"
      onClick={() => onOpen(issueId)}
      className={cn(
        "cursor-grab rounded-xl outline-none focus-visible:ring-4 focus-visible:ring-ring active:cursor-grabbing",
        selected && "ring-2 ring-primary/60",
        isDragging && "opacity-40",
      )}
      {...attributes}
      {...listeners}
    >
      <CardBody issueId={issueId} />
    </div>
  );
}

function Column({
  status,
  ids,
  disabled,
  selectedId,
  onOpen,
  onCreate,
}: {
  status: IssueStatus;
  ids: string[];
  disabled: boolean;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId(status) });
  return (
    <section
      aria-label={statusLabels[status]}
      className={cn(
        "flex max-w-80 min-w-[216px] flex-1 basis-0 flex-col rounded-2xl bg-secondary/70 transition-opacity duration-150 dark:bg-card/60",
        disabled && "opacity-40",
        isOver && !disabled && "ring-2 ring-primary/40",
      )}
      data-testid={`board-column-${status}`}
    >
      <header className="flex h-11 items-center gap-2 px-3 text-footnote font-medium">
        <StatusIcon status={status} />
        {statusLabels[status]}
        <span className="text-muted-foreground tabular-nums">{ids.length}</span>
        <TooltipIconButton variant="ghost" size="icon-xs" className="ml-auto" label={`New ${statusLabels[status]} issue`} onClick={onCreate}>
          <Plus strokeWidth={2} />
        </TooltipIconButton>
      </header>
      <SortableContext id={columnId(status)} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {ids.map((id) => (
            <SortableCard key={id} issueId={id} selected={selectedId === id} onOpen={onOpen} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

/** Pointer-within first so empty columns are easy targets, then nearest corners for ordering inside a column. */
const collisionDetection: CollisionDetection = (args) => {
  const within = pointerWithin(args);
  return within.length > 0 ? within : closestCorners(args);
};

export function IssueBoard({ teamId }: { teamId: string }) {
  const client = useSyncClient();
  const mutate = useMutate();
  const ui = useWorkspaceUi();
  const groups = useSelector(["issue"], (pool) => groupIssueIds(pool, { teamId }), groupsEqual);
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const columns = dragColumns ?? groups;
  const ids = useMemo(() => flattenGroups(groups, boardStatuses), [groups]);
  const nav = useIssueNavigation(ids);
  const activeStatus = activeId ? client.pool.get("issue", activeId)?.status : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = ({ active }: DragStartEvent): void => {
    setActiveId(String(active.id));
    setDragColumns(toColumns(groups));
  };

  const onDragOver = ({ active, over }: DragOverEvent): void => {
    if (!over || !activeStatus) return;
    setDragColumns((current) => current && moveAcross(current, String(active.id), String(over.id), activeStatus));
  };

  const finish = (): void => {
    setActiveId(null);
    setDragColumns(null);
  };

  const onDragEnd = ({ active, over }: DragEndEvent): void => {
    const moving = String(active.id);
    const issue = client.pool.get("issue", moving);
    if (!over || !dragColumns || !issue) {
      finish();
      return;
    }

    const outcome = resolveDrop({
      moving,
      overId: String(over.id),
      columns: dragColumns,
      original: groups,
      currentStatus: issue.status,
      sortOrderOf: (id) => client.pool.get("issue", id)?.sortOrder,
    });
    if (outcome.kind === "forbidden") {
      toast.error(`Can't move from ${statusLabels[outcome.from]} to ${statusLabels[outcome.to]}`, {
        description: "That transition isn't allowed by the team workflow.",
      });
    } else if (outcome.kind === "update") {
      mutate((sync) => sync.updateIssue(moving, outcome.patch));
    }
    finish();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
    >
      <div className="flex h-[calc(100dvh-52px)] gap-3 overflow-x-auto p-4 sm:p-6" data-testid="issue-board">
        {boardStatuses.map((status) => (
          <Column
            key={status}
            status={status}
            ids={columns[status]}
            disabled={activeStatus !== undefined && !canTransition(activeStatus, status)}
            selectedId={nav.selectedId}
            onOpen={nav.onOpen}
            onCreate={() => ui.openCreate({ teamId, status })}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }}>
        {activeId ? <CardBody issueId={activeId} lifted /> : null}
      </DragOverlay>
    </DndContext>
  );
}
