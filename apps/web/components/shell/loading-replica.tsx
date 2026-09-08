"use client";

import { CloudOff } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Long enough for a slow first download, short enough that nobody stares at a skeleton wondering.
const STALLED_AFTER_MS = 8_000;

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

export function ReplicaError({ title, message }: { title: string; message: string }) {
  return (
    <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground dark:bg-white/5">
        <CloudOff className="size-6" strokeWidth={1.75} />
      </span>
      <div className="max-w-sm space-y-1">
        <h1 className="text-headline font-semibold">{title}</h1>
        <p className="text-footnote text-muted-foreground">{message}</p>
      </div>
      <Button onClick={() => window.location.reload()}>Try Again</Button>
    </div>
  );
}

/**
 * Shown until the first bootstrap lands. A first visit has nothing cached, so
 * when the download can't happen the skeleton gives way to an explanation.
 */
export function LoadingReplica({ lastError, connection }: { lastError?: string | null; connection?: string }) {
  const online = useOnline();
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setStalled(true), STALLED_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!online) {
    return (
      <ReplicaError
        title="You're offline"
        message="Tracklane needs a connection the first time it opens on this device. After that it works offline."
      />
    );
  }
  if (stalled && lastError && connection !== "live") {
    return <ReplicaError title="Can't reach Tracklane" message={`Your workspace couldn't be downloaded: ${lastError}`} />;
  }

  return (
    <div className="flex h-dvh" aria-busy="true" aria-live="polite">
      <div className="hidden w-64 shrink-0 space-y-3 border-r border-border/60 bg-sidebar p-4 md:block">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-8 w-full rounded-full" />
        <div className="space-y-2 pt-4">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex h-13 items-center border-b border-border/60 px-6">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="space-y-2 p-6">
          <p className="pb-2 text-footnote text-muted-foreground">Downloading your workspace. Next time it opens instantly, even offline.</p>
          {Array.from({ length: 10 }, (_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      </div>
    </div>
  );
}
