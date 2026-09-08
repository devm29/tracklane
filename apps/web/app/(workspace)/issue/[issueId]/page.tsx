"use client";

import { useParams } from "next/navigation";
import { IssueDetail } from "@/components/issue/issue-detail";

export default function IssuePage() {
  const { issueId } = useParams<{ issueId: string }>();
  return <IssueDetail key={issueId} issueId={issueId} />;
}
