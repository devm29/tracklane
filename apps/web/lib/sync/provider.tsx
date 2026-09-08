"use client";

import type { User } from "@tracklane/domain";
import { MutationRejectedError, type SyncClient } from "@tracklane/sync-core";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { toast } from "sonner";
import { clearSession } from "../session";
import { createWorkspaceClient } from "./create-client";

const SyncClientContext = createContext<SyncClient | null>(null);

type ProviderState = { kind: "loading" } | { kind: "ready"; client: SyncClient } | { kind: "failed"; message: string };

interface SyncProviderProps {
  user: User;
  children: ReactNode;
  loading: ReactNode;
  failed: (message: string) => ReactNode;
}

export function SyncProvider({ user, children, loading, failed }: SyncProviderProps) {
  const [state, setState] = useState<ProviderState>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    // An expired or revoked session drops the replica from this device but keeps unsent
    // changes, so they still go out if the same person signs back in.
    const next: SyncClient = createWorkspaceClient(user, {
      onAuthError: () => {
        void next.wipe({ keepOutbox: true }).finally(clearSession);
      },
      onStoreVersionChange: () => {
        toast("Tracklane was updated in another tab", {
          description: "Reload to keep working.",
          action: { label: "Reload", onClick: () => window.location.reload() },
          duration: Number.POSITIVE_INFINITY,
        });
      },
    });
    const unsubscribe = next.onEvent((event) => {
      if (event.type === "rejected" && event.local) toast.error(event.message, { description: "Your change was rolled back." });
    });
    // Unload skips effect cleanup, so tell the leader tab we stopped looking at the issue.
    const onPageHide = (): void => next.setViewing(null);
    window.addEventListener("pagehide", onPageHide);
    next.start().then(
      () => {
        if (active) setState({ kind: "ready", client: next });
      },
      (error: unknown) => {
        if (!active) return;
        setState({ kind: "failed", message: error instanceof Error ? error.message : "Couldn't open your local workspace." });
      },
    );
    return () => {
      active = false;
      window.removeEventListener("pagehide", onPageHide);
      unsubscribe();
      void next.stop();
    };
  }, [user]);

  if (state.kind === "loading") return loading;
  if (state.kind === "failed") return failed(state.message);
  return <SyncClientContext.Provider value={state.client}>{children}</SyncClientContext.Provider>;
}

/** Supplies an already-running client, for embedding and for tests; SyncProvider is the usual entry point. */
export function SyncClientBoundary({ client, children }: { client: SyncClient; children: ReactNode }) {
  return <SyncClientContext.Provider value={client}>{children}</SyncClientContext.Provider>;
}

export function useSyncClient(): SyncClient {
  const client = useContext(SyncClientContext);
  if (!client) throw new Error("useSyncClient must be used inside <SyncProvider>");
  return client;
}

/**
 * Runs a local mutation. Invalid input and changes the replica already knows
 * the server would refuse become a toast instead of an exception.
 */
export function useMutate(): (run: (client: SyncClient) => void) => boolean {
  const client = useSyncClient();
  return (run) => {
    try {
      run(client);
      return true;
    } catch (error) {
      if (error instanceof MutationRejectedError) {
        toast.error(error.message);
        return false;
      }
      throw error;
    }
  };
}
