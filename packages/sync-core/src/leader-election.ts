import { BroadcastTabChannel, type TabChannel } from "./tabs.js";

export interface LeaderElector {
  readonly isLeader: boolean;
  start(onChange: (isLeader: boolean) => void): void;
  stop(): void;
}

export type ElectionMessage =
  | { type: "probe"; from: string }
  | { type: "heartbeat"; from: string }
  | { type: "claim"; from: string }
  | { type: "resign"; from: string };

export interface HeartbeatElectorOptions {
  tabId: string;
  heartbeatMs?: number;
  timeoutMs?: number;
  claimWindowMs?: number;
}

/**
 * Leader election over a broadcast channel. The leader heartbeats; followers
 * that miss heartbeats for `timeoutMs` open a claim window, and the lowest
 * tab id among concurrent claimants wins. If two leaders ever meet (a healed
 * split, a frozen tab waking up), the higher id steps down.
 */
export class HeartbeatElector implements LeaderElector {
  private leader = false;
  private lastHeartbeat = 0;
  private lastBeatSent = 0;
  private claiming = false;
  private rivals = new Set<string>();
  private heardHeartbeatDuringClaim = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private claimTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private onChange: (isLeader: boolean) => void = () => {};
  private readonly tabId: string;
  private readonly heartbeatMs: number;
  private readonly timeoutMs: number;
  private readonly claimWindowMs: number;

  constructor(private readonly channel: TabChannel<ElectionMessage>, options: HeartbeatElectorOptions) {
    this.tabId = options.tabId;
    this.heartbeatMs = options.heartbeatMs ?? 1_000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.claimWindowMs = options.claimWindowMs ?? 250;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  start(onChange: (isLeader: boolean) => void): void {
    this.onChange = onChange;
    this.unsubscribe = this.channel.subscribe((message) => this.receive(message));
    // Pretend we heard a heartbeat a moment ago so a fresh tab waits one claim window for an existing leader to answer the probe.
    this.lastHeartbeat = Date.now() - this.timeoutMs + this.claimWindowMs;
    this.channel.post({ type: "probe", from: this.tabId });
    this.timer = setInterval(() => this.tick(), Math.min(this.heartbeatMs, this.claimWindowMs));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.claimTimer) clearTimeout(this.claimTimer);
    this.timer = null;
    this.claimTimer = null;
    if (this.leader) this.channel.post({ type: "resign", from: this.tabId });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setLeader(false);
    this.channel.close();
  }

  private tick(): void {
    const now = Date.now();
    if (this.leader) {
      if (now - this.lastBeatSent >= this.heartbeatMs) this.beat();
      return;
    }
    if (!this.claiming && now - this.lastHeartbeat > this.timeoutMs) this.claim();
  }

  private beat(): void {
    this.lastBeatSent = Date.now();
    this.channel.post({ type: "heartbeat", from: this.tabId });
  }

  private claim(): void {
    this.claiming = true;
    this.rivals = new Set();
    this.heardHeartbeatDuringClaim = false;
    this.channel.post({ type: "claim", from: this.tabId });
    this.claimTimer = setTimeout(() => {
      this.claimTimer = null;
      this.claiming = false;
      const outranked = [...this.rivals].some((rival) => rival < this.tabId);
      if (this.heardHeartbeatDuringClaim || outranked) {
        this.lastHeartbeat = Date.now();
        return;
      }
      this.setLeader(true);
      this.beat();
    }, this.claimWindowMs);
  }

  private receive(message: ElectionMessage): void {
    if (message.from === this.tabId) return;
    switch (message.type) {
      case "probe":
        if (this.leader) this.beat();
        break;
      case "heartbeat":
        if (this.leader) {
          if (message.from < this.tabId) this.setLeader(false);
          else this.beat();
        }
        this.lastHeartbeat = Date.now();
        if (this.claiming) this.heardHeartbeatDuringClaim = true;
        break;
      case "claim":
        if (this.leader) this.beat();
        else if (this.claiming) this.rivals.add(message.from);
        break;
      case "resign":
        this.lastHeartbeat = 0;
        break;
    }
  }

  private setLeader(value: boolean): void {
    if (this.leader === value) return;
    this.leader = value;
    if (!value) this.lastHeartbeat = Date.now();
    this.onChange(value);
  }
}

/**
 * Uses the Web Locks API: the tab holding the lock is the leader, and the
 * browser releases it when that tab closes or crashes, so there is no
 * heartbeat timeout to wait out.
 */
export class WebLocksElector implements LeaderElector {
  private leader = false;
  private stopped = false;
  private release: (() => void) | null = null;
  private abort: AbortController | null = null;
  private fallback: LeaderElector | null = null;

  /**
   * `createFallback` takes over if the lock request itself fails (some
   * embedded browsers expose navigator.locks but refuse to grant locks).
   */
  constructor(
    private readonly lockName: string,
    private readonly createFallback?: () => LeaderElector,
  ) {}

  get isLeader(): boolean {
    return this.fallback ? this.fallback.isLeader : this.leader;
  }

  start(onChange: (isLeader: boolean) => void): void {
    if (this.stopped) return;
    this.abort = new AbortController();
    navigator.locks
      .request(this.lockName, { signal: this.abort.signal }, () => {
        if (this.stopped) return Promise.resolve();
        this.leader = true;
        onChange(true);
        return new Promise<void>((resolve) => {
          this.release = resolve;
        });
      })
      .catch((error: unknown) => {
        if (this.stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        if (this.leader) {
          this.leader = false;
          onChange(false);
        }
        if (!this.createFallback) {
          console.error("Leader election via Web Locks failed; this tab will stay a follower", error);
          return;
        }
        this.fallback = this.createFallback();
        this.fallback.start(onChange);
      });
  }

  stop(): void {
    this.stopped = true;
    this.abort?.abort();
    this.release?.();
    this.release = null;
    this.leader = false;
    this.fallback?.stop();
    this.fallback = null;
  }
}

export function createLeaderElector(name: string, tabId: string): LeaderElector {
  const heartbeat = (): LeaderElector =>
    new HeartbeatElector(new BroadcastTabChannel<ElectionMessage>(`${name}:election`), { tabId });
  if (typeof navigator !== "undefined" && "locks" in navigator) return new WebLocksElector(`${name}:leader`, heartbeat);
  return heartbeat();
}
