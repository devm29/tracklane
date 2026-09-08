"use client";

import { LayoutList, Plus, SquareKanban, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { EmptyState } from "@/components/issue/empty-state";
import { IssueBoard } from "@/components/issue/issue-board";
import { IssueList } from "@/components/issue/issue-list";
import { Button } from "@/components/ui/button";
import { useSelector } from "@/lib/sync/hooks";
import { cn } from "@/lib/utils";
import { PageHeader } from "./page-header";
import { useWorkspaceUi } from "./workspace-ui";

function ViewSwitch({ teamKey, view }: { teamKey: string; view: "list" | "board" }) {
  const item = (target: "list" | "board", href: string, label: string, Icon: typeof LayoutList) => (
    <Link
      href={href}
      aria-current={view === target ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-footnote font-medium text-muted-foreground transition-colors duration-150 focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none",
        view === target ? "bg-background text-foreground shadow-sm dark:bg-white/10" : "hover:text-foreground",
      )}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
      {label}
    </Link>
  );
  return (
    <nav aria-label="View" className="flex h-8 items-center rounded-lg bg-secondary p-0.5 dark:bg-white/5">
      {item("list", `/team/${teamKey}`, "List", LayoutList)}
      {item("board", `/team/${teamKey}/board`, "Board", SquareKanban)}
    </nav>
  );
}

export function TeamView({ view }: { view: "list" | "board" }) {
  const params = useParams<{ teamKey: string }>();
  const router = useRouter();
  const ui = useWorkspaceUi();
  const teamKey = params.teamKey.toUpperCase();
  const team = useSelector(["team"], (pool) => pool.all("team").find((candidate) => candidate.key === teamKey));
  const filter = useMemo(() => (team ? { teamId: team.id } : {}), [team]);
  const { setActiveTeamId } = ui;

  useEffect(() => {
    setActiveTeamId(team?.id ?? null);
    return () => setActiveTeamId(null);
  }, [team, setActiveTeamId]);

  if (!team) {
    return (
      <>
        <PageHeader title="Team" />
        <EmptyState icon={Users} title="Team not found" action={<Button onClick={() => router.push("/my-issues")}>Go to my issues</Button>}>
          You might not be a member of {teamKey}, or it doesn&apos;t exist.
        </EmptyState>
      </>
    );
  }

  return (
    <>
      <PageHeader title={team.name}>
        <ViewSwitch teamKey={team.key} view={view} />
        <Button size="sm" aria-label="New issue" onClick={() => ui.openCreate({ teamId: team.id })}>
          <Plus strokeWidth={2} />
          <span className="hidden sm:inline">New issue</span>
        </Button>
      </PageHeader>
      {view === "list" ? (
        <IssueList
          filter={filter}
          createTeamId={team.id}
          emptyTitle={`No issues in ${team.name} yet`}
          emptyMessage="Press C to create the first one. It saves instantly, even offline."
        />
      ) : (
        <IssueBoard teamId={team.id} />
      )}
    </>
  );
}
