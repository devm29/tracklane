"use client";

import {
  DESCRIPTION_MAX_LENGTH,
  type IssueStatus,
  type Priority,
  TITLE_MAX_LENGTH,
  priorityLabels,
  sortOrderBetween,
  statusLabels,
} from "@tracklane/domain";
import { FolderKanban, Tag } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PriorityIcon } from "@/components/issue/priority-icon";
import {
  priorityOptions,
  statusOptions,
  useAssigneeOptions,
  useLabelOptions,
  useProjectOptions,
} from "@/components/issue/pickers";
import { PropertyPicker } from "@/components/issue/property-picker";
import { StatusIcon } from "@/components/issue/status-icon";
import { UserAvatar } from "@/components/issue/user-avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useCollection, useEntity } from "@/lib/sync/hooks";
import { useMutate, useSyncClient } from "@/lib/sync/provider";
import { useWorkspaceUi } from "./workspace-ui";

interface Draft {
  teamId: string;
  title: string;
  description: string;
  status: IssueStatus;
  priority: Priority;
  assigneeId: string | null;
  projectId: string | null;
  labelIds: string[];
}

function Chip({ children, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className="flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-caption font-medium text-foreground/90 transition-colors duration-150 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
      {...props}
    >
      {children}
    </button>
  );
}

export function CreateIssueDialog() {
  const { createDefaults, closeCreate } = useWorkspaceUi();
  const open = createDefaults !== null;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeCreate()}>
      <DialogContent className="gap-0 p-0 sm:max-w-xl" showCloseButton={false}>
        {open && <CreateIssueForm teamId={createDefaults.teamId} status={createDefaults.status} onDone={closeCreate} />}
      </DialogContent>
    </Dialog>
  );
}

function CreateIssueForm({ teamId, status, onDone }: { teamId: string | undefined; status: IssueStatus | undefined; onDone: () => void }) {
  const client = useSyncClient();
  const mutate = useMutate();
  const router = useRouter();
  const teams = useCollection("team");
  const fallbackTeam = teams.find((team) => team.memberIds.includes(client.actor.userId)) ?? teams[0];
  const [draft, setDraft] = useState<Draft>(() => ({
    teamId: teamId ?? fallbackTeam?.id ?? "",
    title: "",
    description: "",
    status: status ?? "todo",
    priority: 0,
    assigneeId: null,
    projectId: null,
    labelIds: [],
  }));
  // The replica may still be empty when the dialog opens, so fall back lazily instead of freezing "" into state.
  const teamIdValue = draft.teamId || fallbackTeam?.id || "";
  const team = useEntity("team", teamIdValue);
  const assignee = useEntity("user", draft.assigneeId);
  const project = useEntity("project", draft.projectId);
  const assigneeOptions = useAssigneeOptions(teamIdValue);
  const projectOptions = useProjectOptions(teamIdValue);
  const labelOptions = useLabelOptions();
  const update = (patch: Partial<Draft>): void => setDraft((current) => ({ ...current, ...patch }));

  const submit = (): void => {
    if (!draft.title.trim() || !teamIdValue) return;
    const first = client.pool
      .all("issue")
      .filter((issue) => issue.teamId === teamIdValue && issue.status === draft.status)
      .reduce<number | undefined>((min, issue) => (min === undefined ? issue.sortOrder : Math.min(min, issue.sortOrder)), undefined);
    let id = "";
    const created = mutate((sync) => {
      id = sync.createIssue({ ...draft, teamId: teamIdValue, sortOrder: sortOrderBetween(undefined, first) });
    });
    if (!created) return;
    onDone();
    toast.success("Issue created", {
      description: draft.title.trim(),
      action: { label: "Open", onClick: () => router.push(`/issue/${id}`) },
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      }}
    >
      <div className="flex items-center gap-2 px-5 pt-4 text-caption text-muted-foreground">
        <PropertyPicker
          label="Team"
          options={teams.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
          selected={[teamIdValue]}
          onSelect={(value) => update({ teamId: value, assigneeId: null, projectId: null })}
        >
          <Chip>{team?.key ?? "Team"}</Chip>
        </PropertyPicker>
        <span aria-hidden>›</span>
        <DialogTitle className="text-caption font-medium text-muted-foreground">New issue</DialogTitle>
        <DialogDescription className="sr-only">Create an issue. It saves instantly and syncs in the background.</DialogDescription>
      </div>
      <div className="space-y-1 px-5 pt-3 pb-4">
        <input
          autoFocus
          aria-label="Issue title"
          value={draft.title}
          maxLength={TITLE_MAX_LENGTH}
          onChange={(event) => update({ title: event.target.value })}
          placeholder="Issue title"
          className="w-full bg-transparent text-title3 leading-7 font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
        />
        <textarea
          aria-label="Description"
          value={draft.description}
          maxLength={DESCRIPTION_MAX_LENGTH}
          onChange={(event) => update({ description: event.target.value })}
          placeholder="Add a description…"
          rows={4}
          className="w-full resize-none bg-transparent text-subhead leading-[1.375rem] outline-none placeholder:text-muted-foreground/60"
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5 px-5 pb-4">
        <PropertyPicker label="Status" options={statusOptions()} selected={[draft.status]} onSelect={(value) => update({ status: value })}>
          <Chip>
            <StatusIcon status={draft.status} className="size-3.5" />
            {statusLabels[draft.status]}
          </Chip>
        </PropertyPicker>
        <PropertyPicker label="Priority" options={priorityOptions} selected={[draft.priority]} onSelect={(value) => update({ priority: value })}>
          <Chip>
            <PriorityIcon priority={draft.priority} className="size-3.5" />
            {priorityLabels[draft.priority]}
          </Chip>
        </PropertyPicker>
        <PropertyPicker label="Assignee" options={assigneeOptions} selected={[draft.assigneeId]} onSelect={(value) => update({ assigneeId: value })}>
          <Chip>
            <UserAvatar user={assignee} size="xs" className="size-4 text-[0.5rem]" />
            {assignee?.name ?? "Assignee"}
          </Chip>
        </PropertyPicker>
        <PropertyPicker label="Project" options={projectOptions} selected={[draft.projectId]} onSelect={(value) => update({ projectId: value })}>
          <Chip>
            <FolderKanban className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            {project?.name ?? "Project"}
          </Chip>
        </PropertyPicker>
        <PropertyPicker
          label="Labels"
          multiple
          options={labelOptions}
          selected={draft.labelIds}
          onSelect={(value) =>
            update({
              labelIds: draft.labelIds.includes(value) ? draft.labelIds.filter((id) => id !== value) : [...draft.labelIds, value],
            })
          }
        >
          <Chip>
            <Tag className="size-3.5 text-muted-foreground" strokeWidth={1.75} />
            {draft.labelIds.length > 0 ? `${draft.labelIds.length} label${draft.labelIds.length === 1 ? "" : "s"}` : "Labels"}
          </Chip>
        </PropertyPicker>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border/60 px-5 py-3">
        <span className="mr-auto hidden items-center gap-1 text-caption text-muted-foreground sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>↵</Kbd> to create
        </span>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={!draft.title.trim() || !teamIdValue}>
          Create issue
        </Button>
      </div>
    </form>
  );
}
