"use client";

import type { IssueStatus } from "@tracklane/domain";
import { type ReactNode, createContext, useContext, useMemo, useState } from "react";

export interface CreateDefaults {
  teamId?: string;
  status?: IssueStatus;
}

interface WorkspaceUi {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  createDefaults: CreateDefaults | null;
  openCreate: (defaults?: CreateDefaults) => void;
  closeCreate: () => void;
  devtoolsOpen: boolean;
  setDevtoolsOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
  focusedIssueId: string | null;
  setFocusedIssueId: (id: string | null) => void;
  /** Team of the page being shown, so "New issue" lands in the right place. */
  activeTeamId: string | null;
  setActiveTeamId: (id: string | null) => void;
}

const WorkspaceUiContext = createContext<WorkspaceUi | null>(null);

export function WorkspaceUiProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<CreateDefaults | null>(null);
  const [devtoolsOpen, setDevtoolsOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusedIssueId, setFocusedIssueId] = useState<string | null>(null);
  const [activeTeamId, setActiveTeamId] = useState<string | null>(null);

  const value = useMemo<WorkspaceUi>(
    () => ({
      paletteOpen,
      setPaletteOpen,
      createDefaults,
      openCreate: (defaults) => setCreateDefaults(defaults ?? {}),
      closeCreate: () => setCreateDefaults(null),
      devtoolsOpen,
      setDevtoolsOpen,
      shortcutsOpen,
      setShortcutsOpen,
      focusedIssueId,
      setFocusedIssueId,
      activeTeamId,
      setActiveTeamId,
    }),
    [paletteOpen, createDefaults, devtoolsOpen, shortcutsOpen, focusedIssueId, activeTeamId],
  );

  return <WorkspaceUiContext.Provider value={value}>{children}</WorkspaceUiContext.Provider>;
}

export function useWorkspaceUi(): WorkspaceUi {
  const value = useContext(WorkspaceUiContext);
  if (!value) throw new Error("useWorkspaceUi must be used inside <WorkspaceUiProvider>");
  return value;
}
