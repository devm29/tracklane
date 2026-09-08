"use client";

import type { Priority } from "@tracklane/domain";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useWorkspaceUi } from "@/components/shell/workspace-ui";
import { useHotkeys } from "@/lib/hotkeys";
import { useMutate } from "@/lib/sync/provider";
import type { RowPicker } from "./issue-row";

function scrollIntoView(id: string): void {
  document.querySelector(`[data-issue-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
}

/** J/K selection, Enter to open, E to rename, S/A/P pickers and 0–4 priorities over an ordered list of ids. */
export function useIssueNavigation(ids: readonly string[]) {
  const router = useRouter();
  const mutate = useMutate();
  const ui = useWorkspaceUi();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ id: string; kind: RowPicker } | null>(null);
  const { setFocusedIssueId } = ui;

  const selected = selectedId && ids.includes(selectedId) ? selectedId : null;

  useEffect(() => {
    setFocusedIssueId(selected);
  }, [selected, setFocusedIssueId]);

  useEffect(() => () => setFocusedIssueId(null), [setFocusedIssueId]);

  const move = (delta: number): void => {
    if (ids.length === 0) return;
    const index = selected ? ids.indexOf(selected) : -1;
    const next = ids[Math.min(ids.length - 1, Math.max(0, index === -1 ? 0 : index + delta))];
    if (next) {
      setSelectedId(next);
      scrollIntoView(next);
    }
  };

  const setPriority = (priority: Priority) => () => {
    if (selected) mutate((client) => client.updateIssue(selected, { priority }));
  };

  const overlayOpen = ui.paletteOpen || ui.createDefaults !== null || ui.shortcutsOpen;
  useHotkeys(
    {
      j: () => move(1),
      arrowdown: () => move(1),
      k: () => move(-1),
      arrowup: () => move(-1),
      enter: () => selected && router.push(`/issue/${selected}`),
      o: () => selected && router.push(`/issue/${selected}`),
      e: () => selected && setEditingId(selected),
      s: () => selected && setPicker({ id: selected, kind: "status" }),
      a: () => selected && setPicker({ id: selected, kind: "assignee" }),
      p: () => selected && setPicker({ id: selected, kind: "priority" }),
      "0": setPriority(0),
      "1": setPriority(1),
      "2": setPriority(2),
      "3": setPriority(3),
      "4": setPriority(4),
      escape: () => {
        setSelectedId(null);
        setEditingId(null);
      },
    },
    !overlayOpen && picker === null && editingId === null,
  );

  const onOpen = useCallback((id: string) => router.push(`/issue/${id}`), [router]);
  const onEditDone = useCallback(() => setEditingId(null), []);
  const onPickerChange = useCallback((id: string, kind: RowPicker | null) => setPicker(kind ? { id, kind } : null), []);

  return {
    selectedId: selected,
    setSelectedId,
    editingId,
    pickerFor: (id: string): RowPicker | null => (picker?.id === id ? picker.kind : null),
    onOpen,
    onEditDone,
    onPickerChange,
  };
}
