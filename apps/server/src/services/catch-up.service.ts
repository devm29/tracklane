import type { CatchUpResponse } from "@tracklane/domain";
import type { CounterRepository } from "../repositories/counter.repository.js";
import type { SyncLogRepository } from "../repositories/sync-log.repository.js";

export class CatchUpService {
  constructor(
    private readonly counters: CounterRepository,
    private readonly syncLog: SyncLogRepository,
    private readonly maxDeltas: number,
  ) {}

  /**
   * Deltas after `lastSyncId`, filtered to the caller's teams. The returned
   * lastSyncId is the workspace counter, not the last visible delta, so a
   * client on a quiet team still moves its cursor forward.
   *
   * The unfiltered count must equal the syncId span; if it doesn't, TTL
   * compaction has removed part of the range and the client has to
   * re-bootstrap. So does a client whose cursor belongs to another epoch.
   */
  async catchUp(workspaceId: string, teamIds: readonly string[], lastSyncId: number, epoch: string): Promise<CatchUpResponse> {
    const { lastSyncId: current, epoch: currentEpoch } = await this.counters.syncCursor(workspaceId);
    if (epoch !== currentEpoch || lastSyncId > current) return { kind: "rebootstrap", lastSyncId: current };
    if (lastSyncId === current) return { kind: "deltas", deltas: [], lastSyncId: current };
    const span = current - lastSyncId;
    if (span > this.maxDeltas) return { kind: "rebootstrap", lastSyncId: current };
    const retained = await this.syncLog.countRange(workspaceId, lastSyncId, current);
    if (retained !== span) return { kind: "rebootstrap", lastSyncId: current };
    const deltas = await this.syncLog.listRange(workspaceId, lastSyncId, current, teamIds);
    return { kind: "deltas", deltas, lastSyncId: current };
  }
}
