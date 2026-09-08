import { type Priority, priorityLabels } from "@tracklane/domain";
import { cn } from "@/lib/utils";

const filledBars: Record<Priority, number> = { 0: 0, 1: 3, 2: 3, 3: 2, 4: 1 };

export function PriorityIcon({ priority, className }: { priority: Priority; className?: string }) {
  if (priority === 1) {
    return (
      <svg viewBox="0 0 16 16" role="img" aria-label={priorityLabels[1]} className={cn("size-4 shrink-0 text-destructive", className)}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="currentColor" />
        <path d="M8 4.6v4.2" stroke="var(--background)" strokeWidth="1.7" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1" fill="var(--background)" />
      </svg>
    );
  }
  if (priority === 0) {
    return (
      <svg viewBox="0 0 16 16" role="img" aria-label={priorityLabels[0]} className={cn("size-4 shrink-0 text-muted-foreground", className)}>
        {[3.5, 8, 12.5].map((x) => (
          <circle key={x} cx={x} cy="8" r="1.1" fill="currentColor" />
        ))}
      </svg>
    );
  }
  const filled = filledBars[priority];
  return (
    <svg viewBox="0 0 16 16" role="img" aria-label={priorityLabels[priority]} className={cn("size-4 shrink-0 text-foreground/80", className)}>
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={2 + bar * 4.5}
          y={10 - bar * 3.5}
          width="3"
          height={4 + bar * 3.5}
          rx="1"
          fill="currentColor"
          opacity={bar < filled ? 1 : 0.25}
        />
      ))}
    </svg>
  );
}
