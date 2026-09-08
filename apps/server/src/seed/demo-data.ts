import type { IssueStatus, LabelColor, Priority, ProjectStatus, Role } from "@tracklane/domain";

export const DEMO_PASSWORD = "tracklane";

export interface SeedUser {
  key: string;
  name: string;
  email: string;
  role: Role;
  avatarHue: number;
}

export interface SeedTeam {
  key: string;
  name: string;
  members: string[];
}

export interface SeedProject {
  key: string;
  team: string;
  name: string;
  description: string;
  status: ProjectStatus;
  targetDate: string | null;
}

export interface SeedIssue {
  title: string;
  status: IssueStatus;
  priority: Priority;
  assignee: string | null;
  labels: string[];
  project?: string;
  description?: string;
  comments?: [author: string, body: string][];
}

export const workspace = { name: "Lumen", slug: "lumen" };

export const users: SeedUser[] = [
  { key: "maya", name: "Maya Chen", email: "maya@lumen.dev", role: "admin", avatarHue: 211 },
  { key: "jonas", name: "Jonas Weber", email: "jonas@lumen.dev", role: "member", avatarHue: 28 },
  { key: "priya", name: "Priya Raman", email: "priya@lumen.dev", role: "member", avatarHue: 145 },
  { key: "diego", name: "Diego Alvarez", email: "diego@lumen.dev", role: "member", avatarHue: 280 },
  { key: "sam", name: "Sam Okafor", email: "sam@lumen.dev", role: "member", avatarHue: 350 },
  { key: "elena", name: "Elena Rossi", email: "elena@lumen.dev", role: "member", avatarHue: 175 },
];

export const teams: SeedTeam[] = [
  { key: "ENG", name: "Engineering", members: ["maya", "jonas", "priya", "elena"] },
  { key: "DES", name: "Design", members: ["maya", "priya", "diego"] },
  { key: "PLT", name: "Platform", members: ["maya", "jonas", "sam"] },
];

export const labels: { key: string; name: string; color: LabelColor }[] = [
  { key: "bug", name: "Bug", color: "red" },
  { key: "feature", name: "Feature", color: "blue" },
  { key: "improvement", name: "Improvement", color: "teal" },
  { key: "performance", name: "Performance", color: "orange" },
  { key: "design", name: "Design", color: "purple" },
  { key: "docs", name: "Docs", color: "gray" },
  { key: "security", name: "Security", color: "yellow" },
];

export const projects: SeedProject[] = [
  {
    key: "offline",
    team: "ENG",
    name: "Offline mode",
    description: "Everything works on a plane. Writes queue locally and sync when the network returns.",
    status: "started",
    targetDate: "2026-11-14",
  },
  {
    key: "realtime",
    team: "ENG",
    name: "Realtime collaboration",
    description: "Presence, live cursors and conflict-free edits across devices.",
    status: "started",
    targetDate: "2026-12-05",
  },
  {
    key: "perf",
    team: "ENG",
    name: "Big workspace performance",
    description: "Stay under 16ms per interaction with 50k issues in the replica.",
    status: "planned",
    targetDate: null,
  },
  {
    key: "ds2",
    team: "DES",
    name: "Design system 2.0",
    description: "Materials, motion tokens and a calmer palette.",
    status: "started",
    targetDate: "2026-11-28",
  },
  {
    key: "onboarding",
    team: "DES",
    name: "Onboarding refresh",
    description: "Get a new teammate from invite to first issue in under a minute.",
    status: "planned",
    targetDate: null,
  },
  {
    key: "scale",
    team: "PLT",
    name: "Horizontal scale-out",
    description: "Run several API instances behind a load balancer with shared presence.",
    status: "started",
    targetDate: "2026-10-31",
  },
];

export const issues: Record<string, SeedIssue[]> = {
  ENG: [
    {
      title: "Replica drifts after the laptop sleeps for 8+ hours",
      status: "in_progress",
      priority: 1,
      assignee: "jonas",
      labels: ["bug"],
      project: "offline",
      description:
        "After a long sleep the socket reconnects but the catch-up request races with the first live delta. We end up skipping a range of syncIds.\n\nRepro: close the lid overnight, open it, edit an issue from another device.",
      comments: [
        ["priya", "I can reproduce this reliably with the dev-tools latency slider at 800ms."],
        ["jonas", "Buffering live deltas until catch-up resolves fixes it locally. PR incoming."],
      ],
    },
    {
      title: "Rebase pending transactions when deltas arrive out of band",
      status: "in_review",
      priority: 2,
      assignee: "priya",
      labels: ["feature"],
      project: "offline",
      comments: [["maya", "Let's make sure the property test covers rejected transactions too."]],
    },
    { title: "IndexedDB quota exceeded on Safari private windows", status: "todo", priority: 2, assignee: "elena", labels: ["bug"], project: "offline" },
    { title: "Keyboard shortcut cheat sheet behind ?", status: "done", priority: 4, assignee: "priya", labels: ["improvement"] },
    { title: "Command palette: fuzzy match on issue identifiers", status: "done", priority: 3, assignee: "elena", labels: ["improvement"] },
    {
      title: "Board view drops cards when dragging across columns quickly",
      status: "in_progress",
      priority: 2,
      assignee: "elena",
      labels: ["bug"],
      comments: [["elena", "Only happens when the drop target re-renders mid-drag. Pinning the sortable ids helps."]],
    },
    { title: "Virtualize the issue list for workspaces over 10k issues", status: "backlog", priority: 3, assignee: null, labels: ["performance"], project: "perf" },
    { title: "Show sync status in the toolbar", status: "done", priority: 3, assignee: "jonas", labels: ["feature"], project: "offline" },
    { title: "Optimistic comment ordering flickers on slow networks", status: "todo", priority: 3, assignee: "priya", labels: ["bug"], project: "realtime" },
    { title: "Batch outbox flushes to 50 transactions per round trip", status: "done", priority: 4, assignee: "jonas", labels: ["performance"], project: "offline" },
    {
      title: "Fall back to heartbeat leader election without Web Locks",
      status: "in_review",
      priority: 3,
      assignee: "maya",
      labels: ["feature"],
      project: "offline",
      comments: [
        ["jonas", "Do we still need this? Every evergreen browser ships Web Locks now."],
        ["maya", "Embedded webviews don't always. It's 120 lines and fully tested, worth keeping."],
      ],
    },
    { title: "Inline title editing loses the caret on remote updates", status: "todo", priority: 2, assignee: "elena", labels: ["bug"], project: "realtime" },
    { title: "Support markdown in issue descriptions", status: "backlog", priority: 4, assignee: null, labels: ["feature"] },
    { title: "Presence avatars on the issue detail view", status: "in_progress", priority: 3, assignee: "priya", labels: ["feature"], project: "realtime" },
    { title: "Adopt Express 5 async error handling", status: "done", priority: 4, assignee: "jonas", labels: ["improvement"] },
    { title: "Flaky Playwright test: two-context board drag", status: "todo", priority: 3, assignee: "elena", labels: ["bug"] },
    { title: "Document the sync protocol for contributors", status: "backlog", priority: 4, assignee: null, labels: ["docs"] },
    { title: "Rate-limit mutation batches per socket", status: "backlog", priority: 3, assignee: null, labels: ["security"] },
    { title: "Archive issues with ⌫ from the list", status: "canceled", priority: 4, assignee: null, labels: ["feature"] },
    { title: "Precompute board column ordering during bootstrap", status: "backlog", priority: 4, assignee: "jonas", labels: ["performance"], project: "perf" },
  ],
  DES: [
    {
      title: "Refine sidebar translucency in dark mode",
      status: "in_progress",
      priority: 3,
      assignee: "diego",
      labels: ["design"],
      project: "ds2",
      comments: [["priya", "The blur reads muddy over the board. Maybe drop saturation to 150%?"]],
    },
    { title: "Empty states for brand-new teams", status: "todo", priority: 4, assignee: "diego", labels: ["design"], project: "onboarding" },
    { title: "Priority icons are hard to tell apart at 16px", status: "in_review", priority: 2, assignee: "diego", labels: ["design"], project: "ds2" },
    { title: "Define motion tokens for sheets and popovers", status: "done", priority: 3, assignee: "priya", labels: ["design"], project: "ds2" },
    { title: "Audit color contrast on status badges", status: "todo", priority: 2, assignee: "priya", labels: ["design"], project: "ds2" },
    { title: "Board card density options", status: "backlog", priority: 4, assignee: null, labels: ["design"] },
    { title: "Onboarding checklist for invited teammates", status: "backlog", priority: 3, assignee: "maya", labels: ["feature"], project: "onboarding" },
    { title: "Focus ring style for keyboard navigation", status: "done", priority: 3, assignee: "diego", labels: ["design"], project: "ds2" },
    { title: "Group command palette results under section headers", status: "in_progress", priority: 4, assignee: "priya", labels: ["design"] },
    { title: "Redesign the issue inspector", status: "todo", priority: 3, assignee: "diego", labels: ["design"] },
  ],
  PLT: [
    { title: "Replica-set healthcheck in docker compose", status: "done", priority: 3, assignee: "sam", labels: ["improvement"] },
    { title: "Compact sync_actions with a TTL index", status: "done", priority: 2, assignee: "jonas", labels: ["performance"] },
    {
      title: "Resume the change stream after a primary step-down",
      status: "in_progress",
      priority: 1,
      assignee: "sam",
      labels: ["bug"],
      project: "scale",
      comments: [["sam", "Keeping the last resume token and reopening with resumeAfter works; adding a chaos test now."]],
    },
    { title: "Redis adapter for multi-instance Socket.IO", status: "in_review", priority: 2, assignee: "jonas", labels: ["feature"], project: "scale" },
    { title: "Structured logs with request ids", status: "done", priority: 3, assignee: "sam", labels: ["improvement"] },
    { title: "Alert when catch-up falls back to re-bootstrap too often", status: "todo", priority: 3, assignee: "sam", labels: ["feature"], project: "scale" },
    { title: "Load test: 500 concurrent sockets per instance", status: "backlog", priority: 3, assignee: null, labels: ["performance"], project: "scale" },
    { title: "Rotate the JWT secret without signing everyone out", status: "backlog", priority: 2, assignee: null, labels: ["security"] },
    { title: "Back up the workspace counters collection", status: "todo", priority: 4, assignee: "jonas", labels: ["improvement"] },
    { title: "Run Mongo as a replica set in CI", status: "done", priority: 3, assignee: "sam", labels: ["improvement"] },
  ],
};
