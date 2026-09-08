import type { PresenceUpdate } from "@tracklane/domain";
import type { TabMessage } from "./tabs.js";

export interface PresenceCoordinatorOptions {
  tabId: string;
  isLeader: () => boolean;
  post: (message: TabMessage) => void;
  /** Hands the union of issues open in any tab to the network layer. */
  report: (issueIds: readonly string[]) => void;
  /** Followers re-announce on this interval; the leader forgets tabs silent for three of them. */
  heartbeatMs?: number;
  now?: () => number;
}

const NO_VIEWERS: readonly string[] = Object.freeze([]);

/**
 * "Who is looking at this issue", across tabs. Every tab says what it shows;
 * only the leader talks to the server, so it aggregates the tabs and fans the
 * server's answers back out. A tab that crashes never says goodbye, which is
 * what the heartbeat expiry is for.
 */
export class PresenceCoordinator {
  private viewing: string | null = null;
  private readonly tabs = new Map<string, { issueId: string; seenAt: number }>();
  private viewers = new Map<string, readonly string[]>();
  private readonly listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastReport: string | null = null;
  private readonly heartbeatMs: number;
  private readonly now: () => number;

  constructor(private readonly options: PresenceCoordinatorOptions) {
    this.heartbeatMs = options.heartbeatMs ?? 10_000;
    this.now = options.now ?? Date.now;
  }

  start(): void {
    this.timer ??= setInterval(() => this.tick(), this.heartbeatMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.options.isLeader() && this.viewing) {
      this.options.post({ type: "viewing", tabId: this.options.tabId, issueId: null });
    }
  }

  setViewing(issueId: string | null): void {
    if (this.viewing === issueId) return;
    this.viewing = issueId;
    this.announce();
  }

  getViewers(issueId: string): readonly string[] {
    return this.viewers.get(issueId) ?? NO_VIEWERS;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** This tab took over the socket: rebuild the aggregate from what followers announce next. */
  becameLeader(): void {
    this.tabs.clear();
    this.lastReport = null;
    this.record(this.options.tabId, this.viewing);
  }

  /** Another tab took over: its view of the server starts empty and it needs to hear from us. */
  leaderChanged(): void {
    this.viewers = new Map();
    this.notify();
    if (!this.options.isLeader() && this.viewing) this.announce();
  }

  receive(tabId: string, issueId: string | null): void {
    if (this.options.isLeader()) this.record(tabId, issueId);
  }

  apply(update: PresenceUpdate): void {
    const next = new Map(this.viewers);
    if (update.viewerIds.length === 0) next.delete(update.issueId);
    else next.set(update.issueId, update.viewerIds);
    this.viewers = next;
    this.notify();
  }

  private announce(): void {
    if (this.options.isLeader()) this.record(this.options.tabId, this.viewing);
    else this.options.post({ type: "viewing", tabId: this.options.tabId, issueId: this.viewing });
  }

  private record(tabId: string, issueId: string | null): void {
    if (issueId) this.tabs.set(tabId, { issueId, seenAt: this.now() });
    else this.tabs.delete(tabId);
    this.report();
  }

  private report(): void {
    const issueIds = [...new Set([...this.tabs.values()].map((entry) => entry.issueId))].sort();
    const key = issueIds.join();
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.options.report(issueIds);
  }

  private tick(): void {
    if (!this.options.isLeader()) {
      if (this.viewing) this.announce();
      return;
    }
    const cutoff = this.now() - this.heartbeatMs * 3;
    for (const [tabId, entry] of this.tabs) {
      if (tabId !== this.options.tabId && entry.seenAt < cutoff) this.tabs.delete(tabId);
    }
    this.report();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
