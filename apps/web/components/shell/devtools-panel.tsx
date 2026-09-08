"use client";

import type { SyncDelta, Transaction } from "@tracklane/domain";
import type { PendingTransaction } from "@tracklane/sync-core";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { TooltipIconButton } from "@/components/shell/tooltip-icon-button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useSelector, useSyncStatus } from "@/lib/sync/hooks";
import { useSyncClient } from "@/lib/sync/provider";
import { cn } from "@/lib/utils";
import { useWorkspaceUi } from "./workspace-ui";

const MAX_DELTAS = 8;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-3 text-footnote">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2 font-medium tabular-nums">{children}</span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h3 className="px-1 pt-3 pb-1.5 text-caption2 font-medium tracking-wide text-muted-foreground uppercase">{children}</h3>;
}

function describe(tx: Transaction): string {
  const { mutation } = tx;
  switch (mutation.kind) {
    case "issue.update":
      return `update ${Object.keys(mutation.patch).join(", ")}`;
    case "issue.create":
      return `create "${mutation.input.title}"`;
    case "comment.create":
      return "add comment";
    default:
      return mutation.kind.replace(".", " ");
  }
}

const stateTone: Record<PendingTransaction["state"], string> = {
  queued: "bg-secondary text-muted-foreground dark:bg-white/10",
  inflight: "bg-primary/15 text-primary",
  acked: "bg-success/15 text-success",
};

const connectionTone = {
  live: "bg-success",
  syncing: "bg-primary",
  connecting: "bg-warning",
  offline: "bg-muted-foreground",
} as const;

export function DevtoolsPanel() {
  const { devtoolsOpen, setDevtoolsOpen } = useWorkspaceUi();
  const client = useSyncClient();
  const status = useSyncStatus();
  const [deltas, setDeltas] = useState<SyncDelta[]>([]);
  const [draftLatency, setDraftLatency] = useState<number | null>(null);
  const latency = draftLatency ?? status.latencyMs;
  const replica = useSelector(
    ["issue", "comment"],
    (pool) => `${pool.size("issue")} issues · ${pool.size("comment")} comments`,
  );

  useEffect(
    () =>
      client.onEvent((event) => {
        if (event.type === "deltas") setDeltas((current) => [...[...event.deltas].reverse(), ...current].slice(0, MAX_DELTAS));
      }),
    [client],
  );

  if (!devtoolsOpen) return null;

  return (
    <aside
      aria-label="Sync inspector"
      data-testid="devtools"
      className="glass fixed right-4 bottom-4 z-40 flex max-h-[calc(100dvh-2rem)] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl ring-1 ring-black/5 animate-in fade-in-0 zoom-in-[0.98] slide-in-from-bottom-2 duration-200 dark:ring-white/10"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-subhead font-semibold tracking-tight">Sync inspector</h2>
          <p className="text-caption text-muted-foreground">
            {status.role === "leader" ? "This tab holds the socket" : "Following the leader tab"}
          </p>
        </div>
        <TooltipIconButton variant="ghost" size="icon-sm" className="ml-auto" label="Close sync inspector" onClick={() => setDevtoolsOpen(false)}>
          <X strokeWidth={1.75} />
        </TooltipIconButton>
      </header>

      <div className="overflow-y-auto px-3 pb-3">
        <SectionLabel>Replica</SectionLabel>
        <div className="divide-y divide-border rounded-xl bg-card/80 ring-1 ring-border/60">
          <Row label="Connection">
            <span className={cn("size-2 rounded-full", connectionTone[status.connection])} />
            <span className="capitalize" data-testid="devtools-connection">
              {status.connection}
            </span>
          </Row>
          <Row label="Tab role">
            <span className="capitalize" data-testid="devtools-role">
              {status.role}
            </span>
          </Row>
          <Row label="lastSyncId">
            <span data-testid="devtools-last-sync-id">{status.lastSyncId}</span>
          </Row>
          <Row label="Local data">{replica}</Row>
        </div>

        <SectionLabel>Network</SectionLabel>
        <div className="divide-y divide-border rounded-xl bg-card/80 ring-1 ring-border/60">
          <label className="flex min-h-10 items-center justify-between gap-3 px-3 text-footnote">
            <span>Offline</span>
            <Switch
              data-testid="devtools-offline"
              checked={!status.networkEnabled}
              onCheckedChange={(offline) => client.setNetworkEnabled(!offline)}
            />
          </label>
          <div className="space-y-2.5 px-3 py-3 text-footnote">
            <div className="flex items-center justify-between">
              <span>Simulated latency</span>
              <span className="text-muted-foreground tabular-nums">{latency} ms</span>
            </div>
            <Slider
              aria-label="Simulated latency"
              min={0}
              max={2000}
              step={50}
              value={[latency]}
              onValueChange={([value]) => setDraftLatency(value ?? 0)}
              onValueCommit={([value]) => {
                client.setSimulatedLatency(value ?? 0);
                setDraftLatency(null);
              }}
            />
          </div>
        </div>

        <SectionLabel>Pending transactions · {status.pending.length}</SectionLabel>
        <div className="rounded-xl bg-card/80 ring-1 ring-border/60" data-testid="devtools-pending">
          {status.pending.length === 0 ? (
            <p className="px-3 py-3 text-footnote text-muted-foreground">Nothing waiting. Every change is confirmed.</p>
          ) : (
            <ul className="divide-y divide-border">
              {status.pending.slice(0, 8).map((item) => (
                <li key={item.tx.clientTxId} className="flex items-center gap-2 px-3 py-2 text-caption">
                  <span className="min-w-0 flex-1 truncate">{describe(item.tx)}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-caption2 font-medium", stateTone[item.state])}>{item.state}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <SectionLabel>Recent deltas</SectionLabel>
        <div className="rounded-xl bg-card/80 ring-1 ring-border/60">
          {deltas.length === 0 ? (
            <p className="px-3 py-3 text-footnote text-muted-foreground">Edit something here or in another window to watch deltas stream in.</p>
          ) : (
            <ul className="divide-y divide-border font-mono text-caption2">
              {deltas.map((delta) => (
                <li key={delta.syncId} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="w-10 shrink-0 text-muted-foreground tabular-nums">#{delta.syncId}</span>
                  <span className="shrink-0">
                    {delta.model}.{delta.action}
                  </span>
                  <span className="truncate text-muted-foreground">{delta.changedFields.slice(0, 3).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
