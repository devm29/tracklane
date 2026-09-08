"use client";

import { type IssueStatus, type Priority, allowedTransitions, priorityLabels, statusLabels } from "@tracklane/domain";
import {
  Archive,
  ArchiveRestore,
  CircleUser,
  CloudOff,
  FolderKanban,
  Keyboard,
  LayoutList,
  Moon,
  Plus,
  RefreshCw,
  SquareKanban,
  UserMinus,
  UserPlus,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { PriorityIcon } from "@/components/issue/priority-icon";
import { StatusIcon } from "@/components/issue/status-icon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { compareIssues, identifier } from "@/lib/issues";
import { useCollection, useEntity, useSyncStatus } from "@/lib/sync/hooks";
import { useMutate, useSyncClient } from "@/lib/sync/provider";
import { useWorkspaceUi } from "./workspace-ui";

const priorityOrder: readonly Priority[] = [1, 2, 3, 4, 0];
const RESULT_LIMIT = 40;

export function CommandPalette() {
  const ui = useWorkspaceUi();
  return (
    <Dialog open={ui.paletteOpen} onOpenChange={ui.setPaletteOpen}>
      <DialogContent
        showCloseButton={false}
        className="glass top-[18%] translate-y-0 gap-0 overflow-hidden rounded-2xl border-0 p-0 ring-1 ring-black/5 sm:max-w-[640px] dark:ring-white/10"
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Search issues and run commands</DialogDescription>
        {ui.paletteOpen && <PaletteBody close={() => ui.setPaletteOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const client = useSyncClient();
  const mutate = useMutate();
  const router = useRouter();
  const ui = useWorkspaceUi();
  const { resolvedTheme, setTheme } = useTheme();
  const status = useSyncStatus();
  const [search, setSearch] = useState("");
  const issues = useCollection("issue");
  const teams = useCollection("team");
  const focused = useEntity("issue", ui.focusedIssueId);
  const focusedTeam = useEntity("team", focused?.teamId);

  const teamById = useMemo(() => new Map(teams.map((team) => [team.id, team])), [teams]);
  const results = useMemo(() => {
    const query = search.trim().toLowerCase();
    const live = issues.filter((issue) => !issue.archivedAt);
    if (!query) return [...live].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    return live
      .filter(
        (issue) =>
          issue.title.toLowerCase().includes(query) ||
          identifier(issue, teamById.get(issue.teamId)).toLowerCase().includes(query),
      )
      .sort(compareIssues)
      .slice(0, RESULT_LIMIT);
  }, [issues, search, teamById]);

  const run = (action: () => void) => () => {
    close();
    action();
  };
  const go = (href: string) => run(() => router.push(href));

  // The digits shown next to "Set priority" work here too, as long as nothing has been typed yet.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!focused || search || event.metaKey || event.ctrlKey || event.altKey) return;
    const priority = priorityOrder.find((candidate) => String(candidate) === event.key && candidate !== focused.priority);
    if (priority === undefined) return;
    event.preventDefault();
    run(() => mutate((sync) => sync.updateIssue(focused.id, { priority })))();
  };

  return (
    <Command loop shouldFilter={false} className="bg-transparent" onKeyDown={onKeyDown}>
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder={focused ? `Search or run a command on ${identifier(focused, focusedTeam)}…` : "Search issues or type a command…"}
        className="h-12 text-subhead"
      />
      <CommandList className="max-h-[420px] p-1.5">
        <CommandEmpty className="py-10 text-center text-footnote text-muted-foreground">No results. Try an issue number like ENG-4.</CommandEmpty>

        {focused && !search && (
          <>
            <CommandGroup heading={`${identifier(focused, focusedTeam)} · ${focused.title}`}>
              {allowedTransitions(focused.status).map((next: IssueStatus) => (
                  <CommandItem key={next} onSelect={run(() => mutate((sync) => sync.updateIssue(focused.id, { status: next })))}>
                    <StatusIcon status={next} />
                    Move to {statusLabels[next]}
                  </CommandItem>
                ))}
              {priorityOrder
                .filter((priority) => priority !== focused.priority)
                .map((priority) => (
                  <CommandItem key={priority} onSelect={run(() => mutate((sync) => sync.updateIssue(focused.id, { priority })))}>
                    <PriorityIcon priority={priority} />
                    Set priority: {priorityLabels[priority]}
                    <CommandShortcut>{priority}</CommandShortcut>
                  </CommandItem>
                ))}
              {focused.assigneeId === client.actor.userId ? (
                <CommandItem onSelect={run(() => mutate((sync) => sync.updateIssue(focused.id, { assigneeId: null })))}>
                  <UserMinus strokeWidth={1.75} /> Unassign
                </CommandItem>
              ) : (
                <CommandItem onSelect={run(() => mutate((sync) => sync.updateIssue(focused.id, { assigneeId: client.actor.userId })))}>
                  <UserPlus strokeWidth={1.75} /> Assign to me
                </CommandItem>
              )}
              {focused.archivedAt ? (
                <CommandItem onSelect={run(() => mutate((sync) => sync.unarchiveIssue(focused.id)))}>
                  <ArchiveRestore strokeWidth={1.75} /> Restore issue
                </CommandItem>
              ) : (
                <CommandItem onSelect={run(() => mutate((sync) => sync.archiveIssue(focused.id)))}>
                  <Archive strokeWidth={1.75} /> Archive issue
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        {results.length > 0 && (
          <CommandGroup heading={search ? "Issues" : "Recently updated"}>
            {results.map((issue) => (
              <CommandItem key={issue.id} value={issue.id} onSelect={go(`/issue/${issue.id}`)}>
                <StatusIcon status={issue.status} />
                <span className="w-16 shrink-0 text-caption text-muted-foreground tabular-nums">
                  {identifier(issue, teamById.get(issue.teamId))}
                </span>
                <span className="truncate">{issue.title}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {!search && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Actions">
              <CommandItem onSelect={run(() => ui.openCreate(ui.activeTeamId ? { teamId: ui.activeTeamId } : undefined))}>
                <Plus strokeWidth={1.75} /> New issue
                <CommandShortcut>C</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={go("/my-issues")}>
                <CircleUser strokeWidth={1.75} /> Go to my issues
              </CommandItem>
              <CommandItem onSelect={go("/projects")}>
                <FolderKanban strokeWidth={1.75} /> Go to projects
              </CommandItem>
              {teams.map((team) => (
                <CommandItem key={`${team.id}-list`} onSelect={go(`/team/${team.key}`)}>
                  <LayoutList strokeWidth={1.75} /> {team.name} issues
                </CommandItem>
              ))}
              {teams.map((team) => (
                <CommandItem key={`${team.id}-board`} onSelect={go(`/team/${team.key}/board`)}>
                  <SquareKanban strokeWidth={1.75} /> {team.name} board
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Developer">
              <CommandItem onSelect={run(() => client.setNetworkEnabled(!status.networkEnabled))}>
                {status.networkEnabled ? <CloudOff strokeWidth={1.75} /> : <RefreshCw strokeWidth={1.75} />}
                {status.networkEnabled ? "Go offline" : "Go back online"}
              </CommandItem>
              <CommandItem onSelect={run(() => ui.setDevtoolsOpen(true))}>
                <Wrench strokeWidth={1.75} /> Open sync inspector
                <CommandShortcut>⌘.</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
                <Moon strokeWidth={1.75} /> Toggle dark mode
              </CommandItem>
              <CommandItem onSelect={run(() => ui.setShortcutsOpen(true))}>
                <Keyboard strokeWidth={1.75} /> Keyboard shortcuts
                <CommandShortcut>?</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          </>
        )}
      </CommandList>
    </Command>
  );
}
