"use client";

import type { ReactNode } from "react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useHotkeys } from "@/lib/hotkeys";
import { useSyncStatus } from "@/lib/sync/hooks";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { CreateIssueDialog } from "./create-issue-dialog";
import { DevtoolsPanel } from "./devtools-panel";
import { LoadingReplica } from "./loading-replica";
import { ShortcutsDialog } from "./shortcuts-dialog";
import { useWorkspaceUi } from "./workspace-ui";

export function WorkspaceShell({ workspaceName, children }: { workspaceName: string; children: ReactNode }) {
  const status = useSyncStatus();
  const ui = useWorkspaceUi();

  useHotkeys({
    "mod+k": () => ui.setPaletteOpen(!ui.paletteOpen),
    "mod+.": () => ui.setDevtoolsOpen(!ui.devtoolsOpen),
    c: () => ui.openCreate(ui.activeTeamId ? { teamId: ui.activeTeamId } : undefined),
    "?": () => ui.setShortcutsOpen(true),
  });

  if (!status.bootstrapped) return <LoadingReplica lastError={status.lastError} connection={status.connection} />;

  return (
    <SidebarProvider>
      <AppSidebar workspaceName={workspaceName} />
      <SidebarInset className="min-w-0 bg-background">{children}</SidebarInset>
      <CommandPalette />
      <CreateIssueDialog />
      <ShortcutsDialog />
      <DevtoolsPanel />
    </SidebarProvider>
  );
}
