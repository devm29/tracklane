"use client";

import {
  COMMENT_MAX_LENGTH,
  DESCRIPTION_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  priorityLabels,
  statusLabels,
} from "@tracklane/domain";
import { Archive, ArchiveRestore, ChevronRight, FileQuestion, FolderKanban, Tag, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { TooltipIconButton } from "@/components/shell/tooltip-icon-button";
import { useWorkspaceUi } from "@/components/shell/workspace-ui";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isEditableTarget, useHotkeys } from "@/lib/hotkeys";
import { identifier } from "@/lib/issues";
import { shallowEqualArrays, useEntity, useSelector, useViewers } from "@/lib/sync/hooks";
import { useMutate, useSyncClient } from "@/lib/sync/provider";
import { EmptyState } from "./empty-state";
import {
  IssueAssigneePicker,
  IssueLabelPicker,
  IssueLabels,
  IssuePriorityPicker,
  IssueProjectPicker,
  IssueStatusPicker,
  PropertyButton,
} from "./pickers";
import { PriorityIcon } from "./priority-icon";
import { RelativeTime } from "./relative-time";
import { StatusIcon } from "./status-icon";
import { UserAvatar } from "./user-avatar";

/**
 * Text that follows remote edits until the user starts typing, then commits on
 * blur. `discard` ends the edit without saving, the way Escape does in a
 * Finder rename.
 */
function useEditableField(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const discarding = useRef(false);
  return {
    field: {
      value: focused ? draft : value,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value),
      onFocus: () => {
        setDraft(value);
        setFocused(true);
      },
      onBlur: () => {
        setFocused(false);
        if (!discarding.current && draft !== value) commit(draft);
        discarding.current = false;
      },
    },
    discard: (element: HTMLElement) => {
      discarding.current = true;
      element.blur();
    },
  };
}

/** Escape inside a field ends the edit there instead of reaching the page's "go back" shortcut. */
function endEditOnEscape(onEscape: (element: HTMLTextAreaElement) => void) {
  return (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onEscape(event.currentTarget);
  };
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1">
      <h3 className="px-2 text-caption2 font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Viewers({ issueId }: { issueId: string }) {
  const client = useSyncClient();
  const viewerIds = useViewers(issueId);
  const others = viewerIds.filter((id) => id !== client.actor.userId);
  const users = useSelector(["user"], (pool) => others.map((id) => pool.get("user", id)).filter((user) => user !== undefined), shallowEqualArrays);
  if (users.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="flex items-center gap-2" data-testid="presence" aria-label={`${users.map((user) => user.name).join(", ")} viewing`}>
          <div className="flex -space-x-1.5">
            {users.slice(0, 3).map((user) => (
              <UserAvatar key={user.id} user={user} size="sm" className="ring-2 ring-background" />
            ))}
          </div>
          <span className="hidden text-caption text-muted-foreground sm:inline">Viewing</span>
        </div>
      </TooltipTrigger>
      <TooltipContent>{users.map((user) => user.name).join(", ")} also here</TooltipContent>
    </Tooltip>
  );
}

function CommentItem({ commentId }: { commentId: string }) {
  const client = useSyncClient();
  const mutate = useMutate();
  const comment = useEntity("comment", commentId);
  const author = useEntity("user", comment?.authorId);
  if (!comment) return null;
  const canDelete = comment.authorId === client.actor.userId || client.actor.role === "admin";
  return (
    <li className="group flex gap-3" data-testid="comment">
      <UserAvatar user={author} size="md" />
      <div className="min-w-0 flex-1 rounded-xl border border-border/60 bg-card px-4 py-3">
        <div className="mb-1 flex items-center gap-2 text-footnote">
          <span className="font-semibold">{author?.name ?? "Someone"}</span>
          <RelativeTime value={comment.createdAt} className="text-muted-foreground tabular-nums" />
          {canDelete && (
            <TooltipIconButton
              variant="ghost"
              size="icon-xs"
              className="ml-auto text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
              label="Delete comment"
              onClick={() => mutate((sync) => sync.deleteComment(comment.id))}
            >
              <Trash2 strokeWidth={1.75} />
            </TooltipIconButton>
          )}
        </div>
        <p className="text-subhead leading-[1.375rem] whitespace-pre-wrap">{comment.body}</p>
      </div>
    </li>
  );
}

function CommentComposer({ issueId, disabled }: { issueId: string; disabled: boolean }) {
  const mutate = useMutate();
  const me = useEntity("user", useSyncClient().actor.userId);
  const [body, setBody] = useState("");
  const submit = (): void => {
    if (!body.trim()) return;
    if (mutate((sync) => sync.addComment({ issueId, body }))) setBody("");
  };
  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <UserAvatar user={me} size="md" />
      <div className="flex-1 rounded-xl border border-input bg-background transition-shadow focus-within:border-primary focus-within:ring-4 focus-within:ring-ring">
        <textarea
          aria-label="Write a comment"
          value={body}
          disabled={disabled}
          maxLength={COMMENT_MAX_LENGTH}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
            if (event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
          placeholder={disabled ? "Restore the issue to comment" : "Leave a comment…"}
          rows={2}
          className="block w-full resize-none bg-transparent px-4 pt-3 text-subhead leading-[1.375rem] outline-none placeholder:text-muted-foreground/70 [field-sizing:content]"
        />
        <div className="flex items-center justify-end gap-2 px-3 pb-2.5">
          <span className="hidden items-center gap-1 text-caption text-muted-foreground sm:flex">
            <Kbd>⌘</Kbd>
            <Kbd>↵</Kbd>
          </span>
          <Button type="submit" size="sm" disabled={disabled || !body.trim()}>
            Comment
          </Button>
        </div>
      </div>
    </form>
  );
}

export function IssueDetail({ issueId }: { issueId: string }) {
  const client = useSyncClient();
  const mutate = useMutate();
  const router = useRouter();
  const ui = useWorkspaceUi();
  const issue = useEntity("issue", issueId);
  const team = useEntity("team", issue?.teamId);
  const assignee = useEntity("user", issue?.assigneeId);
  const creator = useEntity("user", issue?.creatorId);
  const project = useEntity("project", issue?.projectId);
  const commentIds = useSelector(
    ["comment"],
    (pool) =>
      pool
        .all("comment")
        .filter((comment) => comment.issueId === issueId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((comment) => comment.id),
    shallowEqualArrays,
  );
  const { setFocusedIssueId, setActiveTeamId } = ui;

  const title = useEditableField(issue?.title ?? "", (next) => {
    if (next.trim()) mutate((sync) => sync.updateIssue(issueId, { title: next.trim() }));
  });
  const description = useEditableField(issue?.description ?? "", (next) => mutate((sync) => sync.updateIssue(issueId, { description: next })));

  useEffect(() => {
    client.setViewing(issueId);
    setFocusedIssueId(issueId);
    return () => {
      client.setViewing(null);
      setFocusedIssueId(null);
    };
  }, [client, issueId, setFocusedIssueId]);

  useEffect(() => {
    if (issue) setActiveTeamId(issue.teamId);
  }, [issue, setActiveTeamId]);

  const back = (event: globalThis.KeyboardEvent): void => {
    if (event.target instanceof HTMLElement && isEditableTarget(event.target)) {
      event.target.blur();
      return;
    }
    router.push(team ? `/team/${team.key}` : "/my-issues");
  };
  useHotkeys({ escape: back }, !ui.paletteOpen && ui.createDefaults === null && !ui.shortcutsOpen);

  if (!issue) {
    return (
      <>
        <PageHeader title="Issue" />
        <EmptyState icon={FileQuestion} title="Issue not found" action={<Button onClick={() => router.push("/my-issues")}>Go to my issues</Button>}>
          It may have been deleted, or it belongs to a team you&apos;re not a member of.
        </EmptyState>
      </>
    );
  }

  const archived = issue.archivedAt !== null;

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-1.5">
            <Link href={team ? `/team/${team.key}` : "/my-issues"} className="text-muted-foreground hover:text-foreground">
              {team?.name}
            </Link>
            <ChevronRight className="size-3.5 text-muted-foreground" />
            <span className="tabular-nums">{identifier(issue, team)}</span>
          </span>
        }
      >
        <Viewers issueId={issueId} />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => mutate((sync) => (archived ? sync.unarchiveIssue(issueId) : sync.archiveIssue(issueId)))}
        >
          {archived ? <ArchiveRestore strokeWidth={1.75} /> : <Archive strokeWidth={1.75} />}
          {archived ? "Restore" : "Archive"}
        </Button>
      </PageHeader>

      <div className="grid min-h-[calc(100dvh-52px)] grid-cols-1 lg:grid-cols-[1fr_300px]">
        <article className="mx-auto w-full max-w-3xl px-6 py-8 sm:px-10">
          {archived && (
            <p role="status" className="mb-5 rounded-xl bg-secondary px-4 py-2.5 text-footnote text-muted-foreground dark:bg-white/5">
              This issue is archived. Restore it to make changes.
            </p>
          )}
          <textarea
            aria-label="Title"
            {...title.field}
            disabled={archived}
            rows={1}
            maxLength={TITLE_MAX_LENGTH}
            data-testid="issue-title-input"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
              endEditOnEscape(title.discard)(event);
            }}
            className="w-full resize-none bg-transparent text-title1 leading-[2.125rem] font-semibold tracking-tight outline-none [field-sizing:content] disabled:opacity-100"
          />
          <textarea
            aria-label="Description"
            {...description.field}
            disabled={archived}
            maxLength={DESCRIPTION_MAX_LENGTH}
            onKeyDown={endEditOnEscape((element) => element.blur())}
            placeholder="Add a description…"
            className="mt-3 min-h-24 w-full resize-none bg-transparent text-subhead leading-[1.5rem] text-foreground/90 outline-none placeholder:text-muted-foreground/70 [field-sizing:content]"
          />

          <section className="mt-10 border-t border-border/60 pt-6">
            <h2 className="mb-4 text-headline font-semibold">Activity</h2>
            <ol className="mb-6 space-y-4">
              <li className="flex items-center gap-2 pl-1 text-footnote text-muted-foreground">
                <UserAvatar user={creator} size="xs" />
                <span>
                  <span className="font-medium text-foreground">{creator?.name}</span> created the issue · <RelativeTime value={issue.createdAt} />
                </span>
              </li>
              {commentIds.map((id) => (
                <CommentItem key={id} commentId={id} />
              ))}
            </ol>
            <CommentComposer issueId={issueId} disabled={archived} />
          </section>
        </article>

        <aside className="space-y-6 border-t border-border/60 bg-secondary/50 p-4 lg:border-t-0 lg:border-l dark:bg-card/40">
          <InspectorSection title="Properties">
            <IssueStatusPicker issue={issue}>
              <PropertyButton disabled={archived} data-testid="inspector-status">
                <StatusIcon status={issue.status} />
                {statusLabels[issue.status]}
              </PropertyButton>
            </IssueStatusPicker>
            <IssuePriorityPicker issue={issue}>
              <PropertyButton disabled={archived}>
                <PriorityIcon priority={issue.priority} />
                {priorityLabels[issue.priority]}
              </PropertyButton>
            </IssuePriorityPicker>
            <IssueAssigneePicker issue={issue}>
              <PropertyButton disabled={archived}>
                <UserAvatar user={assignee} size="xs" />
                {assignee?.name ?? <span className="text-muted-foreground">Unassigned</span>}
              </PropertyButton>
            </IssueAssigneePicker>
          </InspectorSection>
          <InspectorSection title="Labels">
            <IssueLabelPicker issue={issue}>
              <PropertyButton disabled={archived} className="h-auto min-h-8 flex-wrap py-1.5">
                {issue.labelIds.length > 0 ? (
                  <IssueLabels labelIds={issue.labelIds} max={6} />
                ) : (
                  <>
                    <Tag className="size-4 text-muted-foreground" strokeWidth={1.75} />
                    <span className="text-muted-foreground">Add label</span>
                  </>
                )}
              </PropertyButton>
            </IssueLabelPicker>
          </InspectorSection>
          <InspectorSection title="Project">
            <IssueProjectPicker issue={issue}>
              <PropertyButton disabled={archived}>
                <FolderKanban className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {project?.name ?? <span className="text-muted-foreground">No project</span>}
              </PropertyButton>
            </IssueProjectPicker>
          </InspectorSection>
          <InspectorSection title="Details">
            <dl className="space-y-1.5 px-2 text-footnote">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Created</dt>
                <dd className="tabular-nums">
                  <RelativeTime value={issue.createdAt} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Updated</dt>
                <dd className="tabular-nums">
                  <RelativeTime value={issue.updatedAt} />
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Synced</dt>
                <dd>{issue.number > 0 ? "Yes" : "Waiting for server"}</dd>
              </div>
            </dl>
          </InspectorSection>
        </aside>
      </div>
    </>
  );
}
