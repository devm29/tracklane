"use client";

import { IssueList } from "@/components/issue/issue-list";
import { PageHeader } from "@/components/shell/page-header";
import { useWorkspaceUi } from "@/components/shell/workspace-ui";
import { Button } from "@/components/ui/button";
import { useSyncClient } from "@/lib/sync/provider";
import { Plus } from "lucide-react";
import { useMemo } from "react";

export default function MyIssuesPage() {
  const client = useSyncClient();
  const ui = useWorkspaceUi();
  const filter = useMemo(() => ({ assigneeId: client.actor.userId }), [client]);
  return (
    <>
      <PageHeader title="My issues">
        <Button size="sm" aria-label="New issue" onClick={() => ui.openCreate()}>
          <Plus strokeWidth={2} />
          <span className="hidden sm:inline">New issue</span>
        </Button>
      </PageHeader>
      <IssueList
        filter={filter}
        emptyTitle="Nothing on your plate"
        emptyMessage="Issues assigned to you show up here. Create one or assign yourself from any team."
      />
    </>
  );
}
