"use client";

import type { ProjectStatus } from "@tracklane/domain";
import { CalendarDays, FolderKanban } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/issue/empty-state";
import { UserAvatar } from "@/components/issue/user-avatar";
import { PageHeader } from "@/components/shell/page-header";
import { useCollection } from "@/lib/sync/hooks";
import { cn } from "@/lib/utils";

const statusBadge: Record<ProjectStatus, { label: string; tone: string }> = {
  planned: { label: "Planned", tone: "bg-secondary text-muted-foreground dark:bg-white/10" },
  started: { label: "In progress", tone: "bg-primary/12 text-primary" },
  paused: { label: "Paused", tone: "bg-warning/15 text-warning" },
  completed: { label: "Completed", tone: "bg-success/15 text-success" },
};

export default function ProjectsPage() {
  const projects = useCollection("project");
  const issues = useCollection("issue");
  const teams = useCollection("team");
  const users = useCollection("user");

  return (
    <>
      <PageHeader title="Projects" />
      {projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet">
          Projects group related issues so you can see progress at a glance.
        </EmptyState>
      ) : (
        <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-8 sm:grid-cols-2 sm:px-6 xl:grid-cols-3">
          {[...projects]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((project) => {
              const scoped = issues.filter((issue) => issue.projectId === project.id && !issue.archivedAt);
              const done = scoped.filter((issue) => issue.status === "done").length;
              const progress = scoped.length === 0 ? 0 : Math.round((done / scoped.length) * 100);
              const team = teams.find((candidate) => candidate.id === project.teamId);
              const people = users.filter((user) => scoped.some((issue) => issue.assigneeId === user.id));
              const badge = statusBadge[project.status];
              return (
                <Link
                  key={project.id}
                  href={team ? `/team/${team.key}` : "/projects"}
                  className="group flex flex-col gap-4 rounded-xl border border-border/60 bg-card p-5 shadow-xs transition-[box-shadow,transform] duration-150 hover:shadow-md focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none active:scale-[0.99]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <FolderKanban className="size-[18px]" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="truncate text-headline leading-[1.375rem] font-semibold">{project.name}</h2>
                      <p className="text-footnote text-muted-foreground">{team?.name}</p>
                    </div>
                    <span className={cn("ml-auto inline-flex h-5 shrink-0 items-center rounded-full px-2 text-caption2 font-medium", badge.tone)}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="line-clamp-2 min-h-10 text-body-sm text-muted-foreground">{project.description}</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-caption text-muted-foreground tabular-nums">
                      <span>
                        {done} of {scoped.length} done
                      </span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-secondary dark:bg-white/10" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${project.name} progress`}>
                      <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-caption text-muted-foreground">
                    <div className="flex -space-x-1.5">
                      {people.slice(0, 4).map((user) => (
                        <UserAvatar key={user.id} user={user} size="xs" className="ring-2 ring-card" />
                      ))}
                    </div>
                    {project.targetDate && (
                      <span className="ml-auto flex items-center gap-1 tabular-nums">
                        <CalendarDays className="size-3.5" strokeWidth={1.75} />
                        {new Date(`${project.targetDate}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
        </main>
      )}
    </>
  );
}
