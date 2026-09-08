"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { LoadingReplica, ReplicaError } from "@/components/shell/loading-replica";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { WorkspaceUiProvider } from "@/components/shell/workspace-ui";
import { useSession } from "@/lib/session";
import { SyncProvider } from "@/lib/sync/provider";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  if (!session) return null;

  return (
    <SyncProvider
      key={session.user.id}
      user={session.user}
      loading={<LoadingReplica />}
      failed={(message) => <ReplicaError title="Couldn't open your workspace" message={message} />}
    >
      <WorkspaceUiProvider>
        <WorkspaceShell workspaceName={session.workspace.name}>{children}</WorkspaceShell>
      </WorkspaceUiProvider>
    </SyncProvider>
  );
}
