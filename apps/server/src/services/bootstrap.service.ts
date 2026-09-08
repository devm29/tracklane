import type { BootstrapPayload, User } from "@tracklane/domain";
import { notFound } from "../errors.js";
import type { CounterRepository } from "../repositories/counter.repository.js";
import type { WorkspaceRepository } from "../repositories/workspace.repository.js";
import type { AccessContext } from "./access.service.js";
import type { TransactionRunner } from "./transaction-runner.js";

export class BootstrapService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly workspaces: WorkspaceRepository,
    private readonly counters: CounterRepository,
  ) {}

  /**
   * Full replica for one user. A snapshot-isolated read transaction makes the
   * returned lastSyncId describe exactly the returned entities, so delta
   * catch-up can start from it without gaps or double application.
   */
  async bootstrap(context: AccessContext): Promise<BootstrapPayload> {
    const { user, teamIds } = context;
    return this.transactions.run(
      async (session) => {
        const { lastSyncId, epoch } = await this.counters.syncCursor(user.workspaceId, session);
        const snapshot = await this.workspaces.snapshot(user.workspaceId, teamIds, session);
        const me = snapshot.users.find((candidate: User) => candidate.id === user.id);
        if (!me) throw notFound("User not found");
        return { lastSyncId, epoch, me, ...snapshot };
      },
      { readConcern: { level: "snapshot" } },
    );
  }
}
