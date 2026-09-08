import type { LeaderElector } from "./leader-election.js";
import type { TabChannel, TabMessage } from "./tabs.js";

export interface TabSetup {
  channel: TabChannel<TabMessage>;
  elector: LeaderElector;
}

export interface TabHandlers {
  onRoleChange(isLeader: boolean): Promise<void> | void;
  onMessage(message: TabMessage): Promise<void> | void;
  onError(error: unknown): void;
}

/**
 * Cross-tab plumbing: leader election and the broadcast channel. Election
 * results and messages are handled strictly one at a time, and only after the
 * replica has loaded, so a handler never sees half-applied state. Without a
 * TabSetup it degrades to a single tab that never posts anything.
 */
export class TabCoordinator {
  private chain: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly setup: TabSetup | undefined,
    private readonly handlers: TabHandlers,
  ) {}

  get shared(): boolean {
    return this.setup !== undefined;
  }

  /** Subscribes right away so nothing is missed, but defers handling until `ready` settles. */
  listen(ready: Promise<void>): void {
    this.chain = ready.then(
      () => undefined,
      () => undefined,
    );
    if (!this.setup) return;
    this.unsubscribe = this.setup.channel.subscribe((message) => this.enqueue(() => this.handlers.onMessage(message)));
  }

  elect(): void {
    if (!this.setup) return;
    this.setup.channel.post({ type: "hello" });
    this.setup.elector.start((isLeader) => this.enqueue(() => this.handlers.onRoleChange(isLeader)));
  }

  post(message: TabMessage): void {
    this.setup?.channel.post(message);
  }

  stop(): void {
    if (!this.setup) return;
    this.setup.elector.stop();
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.setup.channel.close();
  }

  async idle(): Promise<void> {
    await this.chain;
  }

  private enqueue(work: () => Promise<void> | void): void {
    this.chain = this.chain.then(work).catch((error: unknown) => this.handlers.onError(error));
  }
}
