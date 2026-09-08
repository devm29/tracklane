"use client";

import { CloudOff, RefreshCw } from "lucide-react";
import { useSyncStatus } from "@/lib/sync/hooks";
import { cn } from "@/lib/utils";

export function SyncIndicator({ onClick }: { onClick?: () => void }) {
  const status = useSyncStatus();
  const pending = status.pending.length;
  const offline = !status.networkEnabled || status.connection === "offline";
  const waiting = pending > 0 ? ` · ${pending} waiting` : "";
  const label = offline
    ? `Offline${waiting}`
    : status.connection === "connecting"
      ? `Connecting${waiting}`
      : status.connection === "syncing"
        ? "Syncing…"
        : pending > 0
          ? `Saving ${pending}…`
          : "Synced";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-live="polite"
      className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent focus-visible:ring-4 focus-visible:ring-ring focus-visible:outline-none"
      data-testid="sync-indicator"
      data-connection={status.connection}
    >
      {offline ? (
        <CloudOff className="size-3.5 text-warning" strokeWidth={2} />
      ) : status.connection !== "live" || pending > 0 ? (
        <RefreshCw className="size-3.5 animate-spin text-primary motion-reduce:animate-none" strokeWidth={2} />
      ) : (
        <span className={cn("size-2 rounded-full bg-success")} />
      )}
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
