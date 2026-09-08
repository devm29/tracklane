"use client";

import { isClosed } from "@tracklane/domain";
import {
  CircleUser,
  FolderKanban,
  Keyboard,
  LayoutList,
  LogOut,
  Moon,
  Search,
  SquareKanban,
  Sun,
  SunMoon,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState } from "react";
import { UserAvatar } from "@/components/issue/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { clearSession } from "@/lib/session";
import { useCollection, useEntity, useSelector } from "@/lib/sync/hooks";
import { useSyncClient } from "@/lib/sync/provider";
import { SyncIndicator } from "./sync-indicator";
import { useWorkspaceUi } from "./workspace-ui";

export function AppSidebar({ workspaceName }: { workspaceName: string }) {
  const client = useSyncClient();
  const pathname = usePathname();
  const router = useRouter();
  const { setTheme } = useTheme();
  const ui = useWorkspaceUi();
  const me = useEntity("user", client.actor.userId);
  const teams = useCollection("team");
  const myOpenCount = useSelector(["issue"], (pool) =>
    pool.all("issue").filter((issue) => issue.assigneeId === client.actor.userId && !issue.archivedAt && !isClosed(issue.status)).length,
  );

  const [unsyncedAtSignOut, setUnsyncedAtSignOut] = useState<number | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Signing out removes the workspace from this device, so a shared computer doesn't keep someone else's issues.
  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await client.wipe();
    } finally {
      clearSession();
      router.replace("/login");
    }
  };
  const requestSignOut = (): void => {
    const unsynced = client.getStatus().pending.length;
    if (unsynced > 0) setUnsyncedAtSignOut(unsynced);
    else void signOut();
  };

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 pt-4">
        <div className="flex items-center gap-2 px-1">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-caption font-semibold text-primary-foreground">
            {workspaceName.slice(0, 1)}
          </span>
          <span className="text-subhead font-semibold tracking-tight">{workspaceName}</span>
        </div>
        <button
          type="button"
          onClick={() => ui.setPaletteOpen(true)}
          className="flex h-8 items-center gap-2 rounded-full bg-secondary px-3 text-footnote text-muted-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none dark:bg-white/5"
        >
          <Search className="size-3.5" strokeWidth={2} />
          <span>Search or jump to…</span>
          <Kbd className="ml-auto">⌘K</Kbd>
        </button>
      </SidebarHeader>

      <SidebarContent className="px-1">
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/my-issues"}>
                <Link href="/my-issues">
                  <CircleUser strokeWidth={1.75} />
                  <span>My issues</span>
                </Link>
              </SidebarMenuButton>
              {myOpenCount > 0 && <SidebarMenuBadge className="tabular-nums">{myOpenCount}</SidebarMenuBadge>}
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === "/projects"}>
                <Link href="/projects">
                  <FolderKanban strokeWidth={1.75} />
                  <span>Projects</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Your teams</SidebarGroupLabel>
          <SidebarMenu>
            {[...teams]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((team) => {
                const base = `/team/${team.key}`;
                return (
                  <SidebarMenuItem key={team.id}>
                    <SidebarMenuButton asChild isActive={pathname === base}>
                      <Link href={base}>
                        <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-primary/12 text-[0.625rem] font-semibold text-primary">
                          {team.name.slice(0, 1)}
                        </span>
                        <span>{team.name}</span>
                      </Link>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === base} className="text-footnote">
                          <Link href={base}>
                            <LayoutList strokeWidth={1.75} />
                            <span>Issues</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild isActive={pathname === `${base}/board`} className="text-footnote">
                          <Link href={`${base}/board`}>
                            <SquareKanban strokeWidth={1.75} />
                            <span>Board</span>
                          </Link>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                );
              })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-1 px-2 pb-3">
        <SyncIndicator onClick={() => ui.setDevtoolsOpen(!ui.devtoolsOpen)} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-10" aria-label="Account menu">
              <UserAvatar user={me} size="sm" />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-footnote font-medium">{me?.name}</span>
                <span className="truncate text-caption2 text-muted-foreground">{me?.email}</span>
              </span>
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-60">
            <DropdownMenuLabel className="text-caption2 font-medium tracking-wide text-muted-foreground uppercase">
              Appearance
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setTheme("light")}>
              <Sun strokeWidth={1.75} /> Light
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("dark")}>
              <Moon strokeWidth={1.75} /> Dark
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme("system")}>
              <SunMoon strokeWidth={1.75} /> Match system
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => ui.setShortcutsOpen(true)}>
              <Keyboard strokeWidth={1.75} /> Keyboard shortcuts
              <span className="ml-auto text-caption2 opacity-70">?</span>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => ui.setDevtoolsOpen(true)}>
              <Wrench strokeWidth={1.75} /> Sync inspector
              <span className="ml-auto text-caption2 opacity-70">⌘.</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={requestSignOut}>
              <LogOut strokeWidth={1.75} /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <Dialog open={unsyncedAtSignOut !== null} onOpenChange={(open) => !open && setUnsyncedAtSignOut(null)}>
        <DialogContent showCloseButton={false} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out with unsynced changes?</DialogTitle>
            <DialogDescription>
              {unsyncedAtSignOut === 1 ? "1 change hasn't" : `${unsyncedAtSignOut ?? 0} changes haven't`} reached the server yet. Signing out
              removes them from this device.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setUnsyncedAtSignOut(null)} autoFocus>
              Cancel
            </Button>
            <Button variant="destructive" disabled={signingOut} onClick={() => void signOut()}>
              Sign Out
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
