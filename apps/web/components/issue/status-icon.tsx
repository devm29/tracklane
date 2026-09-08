import type { IssueStatus } from "@tracklane/domain";
import { statusLabels } from "@tracklane/domain";
import { cn } from "@/lib/utils";

const tone: Record<IssueStatus, string> = {
  backlog: "text-muted-foreground",
  todo: "text-muted-foreground",
  in_progress: "text-warning",
  in_review: "text-success",
  done: "text-primary",
  canceled: "text-muted-foreground",
};

export function StatusIcon({ status, className }: { status: IssueStatus; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={statusLabels[status]}
      className={cn("size-4 shrink-0", tone[status], className)}
      fill="none"
    >
      {status === "backlog" && (
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.2 2.2" />
      )}
      {status === "todo" && <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />}
      {(status === "in_progress" || status === "in_review") && (
        <>
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
          <path
            d={status === "in_progress" ? "M8 4.5a3.5 3.5 0 0 1 0 7z" : "M8 4.5a3.5 3.5 0 1 1-3.03 5.25L8 8z"}
            fill="currentColor"
          />
        </>
      )}
      {status === "done" && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" />
          <path d="m5.2 8.2 1.9 1.9 3.7-4" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {status === "canceled" && (
        <>
          <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.55" />
          <path d="m5.8 5.8 4.4 4.4m0-4.4-4.4 4.4" stroke="var(--background)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
