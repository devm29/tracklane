"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspaceUi } from "./workspace-ui";

const groups: { title: string; items: [keys: string[], label: string][] }[] = [
  {
    title: "Anywhere",
    items: [
      [["⌘", "K"], "Command palette"],
      [["C"], "New issue"],
      [["⌘", "."], "Sync inspector"],
      [["⌘", "B"], "Toggle sidebar"],
      [["?"], "This list"],
    ],
  },
  {
    title: "Issue list and board",
    items: [
      [["J"], "Next issue"],
      [["K"], "Previous issue"],
      [["↵"], "Open issue"],
      [["E"], "Rename inline"],
      [["S"], "Change status"],
      [["A"], "Assign"],
      [["0", "–", "4"], "Set priority"],
    ],
  },
  {
    title: "Issue",
    items: [
      [["Esc"], "Back to list"],
      [["⌘", "↵"], "Post comment"],
    ],
  },
];

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useWorkspaceUi();
  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Tracklane is built to be driven from the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.title}>
              <h3 className="mb-1.5 text-caption2 font-medium tracking-wide text-muted-foreground uppercase">{group.title}</h3>
              <ul className="divide-y divide-border rounded-xl border border-border/60">
                {group.items.map(([keys, label]) => (
                  <li key={label} className="flex h-10 items-center justify-between px-3 text-footnote">
                    <span>{label}</span>
                    <span className="flex gap-1">
                      {keys.map((key) => (
                        <Kbd key={key}>{key}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
