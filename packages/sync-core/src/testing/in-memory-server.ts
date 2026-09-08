import {
  type AnyEntity,
  type BootstrapPayload,
  type CatchUpResponse,
  type Comment,
  type EntityReader,
  type Issue,
  type Label,
  type ModelMap,
  type ModelName,
  type MutationActor,
  type Project,
  type SyncDelta,
  type Team,
  type Transaction,
  type TxResult,
  type User,
  type Workspace,
  canAccessTeam,
  executeMutation,
  modelNames,
} from "@tracklane/domain";

export interface InMemoryServerSeed {
  workspace: Workspace;
  users: User[];
  teams: Team[];
  projects?: Project[];
  labels?: Label[];
  issues?: Issue[];
  comments?: Comment[];
}

interface Subscriber {
  delta(delta: SyncDelta): void;
  resync(): void;
}

/**
 * Reference implementation of the server's sync contract, driven by the same
 * mutation engine as the real API. Property tests use it as the source of
 * truth that every replica must converge to.
 */
export class InMemorySyncServer implements EntityReader {
  lastSyncId = 0;
  epoch = "epoch-1";
  private readonly tables = new Map<ModelName, Map<string, AnyEntity>>();
  private log: SyncDelta[] = [];
  private oldestRetained = 1;
  private readonly processed = new Map<string, number>();
  private readonly issueCounters = new Map<string, number>();
  private readonly subscribers = new Map<Subscriber, string>();
  private clock = Date.parse("2026-01-01T00:00:00.000Z");

  constructor(public seed: InMemoryServerSeed) {
    for (const model of modelNames) this.tables.set(model, new Map());
    this.load(seed);
  }

  get<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined {
    return this.table(model).get(id) as ModelMap[M] | undefined;
  }

  actorFor(userId: string): MutationActor {
    const user = this.get("user", userId);
    if (!user) throw new Error(`Unknown user ${userId}`);
    return { userId, workspaceId: user.workspaceId, role: user.role };
  }

  visibleTeamIds(userId: string): Set<string> {
    const actor = this.actorFor(userId);
    return new Set(this.seed.teams.filter((team) => canAccessTeam(team, actor)).map((team) => team.id));
  }

  bootstrap(userId: string): BootstrapPayload {
    const me = this.get("user", userId);
    if (!me) throw new Error(`Unknown user ${userId}`);
    const teams = this.visibleTeamIds(userId);
    const visible = <M extends "issue" | "comment" | "project">(model: M): ModelMap[M][] =>
      [...this.table(model).values()].filter((entity) => teams.has((entity as ModelMap[M]).teamId)) as ModelMap[M][];
    return structuredClone({
      lastSyncId: this.lastSyncId,
      epoch: this.epoch,
      workspace: this.seed.workspace,
      me,
      users: [...this.table("user").values()] as User[],
      teams: this.seed.teams.filter((team) => teams.has(team.id)),
      projects: visible("project"),
      labels: [...this.table("label").values()] as Label[],
      issues: visible("issue"),
      comments: visible("comment"),
    });
  }

  catchUp(userId: string, lastSyncId: number, epoch: string): CatchUpResponse {
    if (epoch !== this.epoch || lastSyncId > this.lastSyncId || lastSyncId + 1 < this.oldestRetained) {
      return { kind: "rebootstrap", lastSyncId: this.lastSyncId };
    }
    const teams = this.visibleTeamIds(userId);
    const deltas = this.log.filter((delta) => delta.syncId > lastSyncId && teams.has(delta.teamId));
    return structuredClone({ kind: "deltas", deltas, lastSyncId: this.lastSyncId });
  }

  push(userId: string, txs: readonly Transaction[]): TxResult[] {
    const actor = this.actorFor(userId);
    return txs.map((tx): TxResult => {
      const previous = this.processed.get(tx.clientTxId);
      if (previous !== undefined) return { clientTxId: tx.clientTxId, status: "accepted", syncId: previous };

      const result = executeMutation(this, tx.mutation, {
        actor,
        now: this.tick(),
        allocateIssueNumber: (teamId) => {
          const next = (this.issueCounters.get(teamId) ?? 0) + 1;
          this.issueCounters.set(teamId, next);
          return next;
        },
      });
      if (!result.ok) return { clientTxId: tx.clientTxId, status: "rejected", ...result.rejection };
      if (!result.write) return { clientTxId: tx.clientTxId, status: "noop" };

      const { write } = result;
      const syncId = ++this.lastSyncId;
      if (write.action === "remove") this.table(write.model).delete(write.id);
      else this.table(write.model).set(write.id, write.data);

      const base = {
        syncId,
        modelId: write.id,
        teamId: write.teamId,
        changedFields: write.changedFields,
        clientTxId: tx.clientTxId,
        actorId: actor.userId,
        createdAt: this.tick(),
      };
      const delta: SyncDelta =
        write.model === "issue"
          ? { ...base, model: "issue", action: "upsert", data: write.data }
          : write.action === "upsert"
            ? { ...base, model: "comment", action: "upsert", data: write.data }
            : { ...base, model: "comment", action: "remove", data: null };
      this.log.push(delta);
      this.processed.set(tx.clientTxId, syncId);
      for (const [subscriber, subscriberId] of this.subscribers) {
        if (this.visibleTeamIds(subscriberId).has(delta.teamId)) subscriber.delta(structuredClone(delta));
      }
      return { clientTxId: tx.clientTxId, status: "accepted", syncId };
    });
  }

  subscribe(userId: string, subscriber: Subscriber): () => void {
    this.subscribers.set(subscriber, userId);
    return () => this.subscribers.delete(subscriber);
  }

  /** Changes a team's membership and tells that user's connections to resync, as the real gateway does. */
  setMembership(teamId: string, userId: string, member: boolean): void {
    const team = this.seed.teams.find((candidate) => candidate.id === teamId);
    if (!team) throw new Error(`Unknown team ${teamId}`);
    const memberIds = team.memberIds.filter((id) => id !== userId);
    team.memberIds = member ? [...memberIds, userId] : memberIds;
    this.table("team").set(team.id, team);
    for (const [subscriber, subscriberId] of this.subscribers) if (subscriberId === userId) subscriber.resync();
  }

  /** What a reseed does: fresh data, the counter back at zero, and a new epoch. */
  reset(seed: InMemoryServerSeed): void {
    this.lastSyncId = 0;
    this.epoch = `epoch-${Number(this.epoch.slice("epoch-".length)) + 1}`;
    this.log = [];
    this.oldestRetained = 1;
    this.processed.clear();
    this.issueCounters.clear();
    for (const table of this.tables.values()) table.clear();
    this.seed = seed;
    this.load(seed);
  }

  private load(seed: InMemoryServerSeed): void {
    for (const user of seed.users) this.table("user").set(user.id, user);
    for (const team of seed.teams) this.table("team").set(team.id, team);
    for (const project of seed.projects ?? []) this.table("project").set(project.id, project);
    for (const label of seed.labels ?? []) this.table("label").set(label.id, label);
    for (const issue of seed.issues ?? []) {
      this.table("issue").set(issue.id, issue);
      this.issueCounters.set(issue.teamId, Math.max(this.issueCounters.get(issue.teamId) ?? 0, issue.number));
    }
    for (const comment of seed.comments ?? []) this.table("comment").set(comment.id, comment);
  }

  /** Drops the whole delta log, as TTL compaction would; replicas behind it must re-bootstrap. */
  compact(): void {
    this.log = [];
    this.oldestRetained = this.lastSyncId + 1;
  }

  visibleEntities<M extends ModelName>(userId: string, model: M): ModelMap[M][] {
    const teams = this.visibleTeamIds(userId);
    return [...this.table(model).values()].filter((entity) => !("teamId" in entity) || teams.has(entity.teamId)) as ModelMap[M][];
  }

  private tick(): string {
    this.clock += 1_000;
    return new Date(this.clock).toISOString();
  }

  private table(model: ModelName): Map<string, AnyEntity> {
    const table = this.tables.get(model);
    if (!table) throw new Error(`Unknown model ${model}`);
    return table;
  }
}
