import type { Label, LabelColor } from "@tracklane/domain";
import { cn } from "@/lib/utils";

export const labelDot: Record<LabelColor, string> = {
  red: "bg-destructive",
  orange: "bg-warning",
  yellow: "bg-chart-4",
  green: "bg-success",
  teal: "bg-chart-2",
  blue: "bg-chart-1",
  indigo: "bg-chart-3",
  purple: "bg-label-purple",
  gray: "bg-muted-foreground",
};

export function LabelPill({ label, className }: { label: Label; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border border-border px-2 text-caption2 font-medium text-muted-foreground",
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", labelDot[label.color])} />
      {label.name}
    </span>
  );
}
