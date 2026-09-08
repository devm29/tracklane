import type { ReactNode } from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

export function PageHeader({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <header className="material sticky top-0 z-30 flex h-13 shrink-0 items-center gap-2 border-b border-border/60 px-4">
      <SidebarTrigger className="-ml-1 size-8 rounded-md" aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
      <h1 className="min-w-0 truncate text-subhead font-semibold tracking-tight">{title}</h1>
      <div className="ml-auto flex items-center gap-1.5">{children}</div>
    </header>
  );
}
