import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-24 text-center">
      <Icon className="mb-2 size-11 text-muted-foreground/70" strokeWidth={1.25} />
      <h2 className="text-headline leading-[1.375rem] font-semibold">{title}</h2>
      <p className="max-w-sm text-body-sm text-muted-foreground">{children}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}
