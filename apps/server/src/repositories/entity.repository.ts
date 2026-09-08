import {
  type AnyEntity,
  type EntityReader,
  type EntityRef,
  type EntityWrite,
  type ModelMap,
  type ModelName,
  type Mutation,
  referencedEntities,
} from "@tracklane/domain";
import type { ClientSession } from "mongoose";
import { duplicateKeyFields } from "../errors.js";
import { fromComment, fromIssue, toComment, toIssue, toLabel, toProject, toTeam, toUser } from "../db/mappers.js";
import type { CommentDoc, IssueDoc, LabelDoc, Models, ProjectDoc, TeamDoc, UserDoc } from "../db/models.js";

const MAX_REF_ROUNDS = 4;

type Key = `${ModelName}:${string}`;

class SnapshotReader implements EntityReader {
  readonly entries = new Map<Key, AnyEntity | null>();

  get<M extends ModelName>(model: M, id: string): ModelMap[M] | undefined {
    return (this.entries.get(`${model}:${id}`) ?? undefined) as ModelMap[M] | undefined;
  }

  has(ref: EntityRef): boolean {
    return this.entries.has(`${ref.model}:${ref.id}`);
  }
}

/** The id is taken by a document in another workspace; reported to the client as a conflict, never overwritten. */
export class EntityIdTakenError extends Error {
  constructor(readonly model: ModelName, readonly id: string) {
    super(`${model} ${id} already exists`);
    this.name = "EntityIdTakenError";
  }
}

export class EntityRepository {
  constructor(private readonly models: Models) {}

  /**
   * Loads, inside the caller's transaction, every document the mutation engine
   * will look at. Refs are discovered in rounds because some depend on
   * documents loaded in the previous round.
   */
  async loadForMutation(workspaceId: string, mutation: Mutation, session: ClientSession): Promise<EntityReader> {
    const reader = new SnapshotReader();
    for (let round = 0; round < MAX_REF_ROUNDS; round += 1) {
      const missing = referencedEntities(mutation, reader).filter((ref) => !reader.has(ref));
      if (missing.length === 0) break;
      const byModel = new Map<ModelName, Set<string>>();
      for (const ref of missing) {
        const ids = byModel.get(ref.model) ?? new Set<string>();
        ids.add(ref.id);
        byModel.set(ref.model, ids);
      }
      for (const [model, ids] of byModel) {
        const found = await this.findMany(model, workspaceId, [...ids], session);
        for (const id of ids) reader.entries.set(`${model}:${id}`, found.get(id) ?? null);
      }
    }
    return reader;
  }

  /**
   * Every write is scoped to the actor's workspace. Ids are client-generated,
   * so an upsert whose id belongs to another tenant fails on the _id index
   * instead of matching (and replacing) that tenant's document.
   */
  async applyWrite(workspaceId: string, write: EntityWrite, session: ClientSession): Promise<void> {
    const filter = { _id: write.id, workspaceId };
    try {
      if (write.model === "issue") {
        await this.models.Issue.replaceOne(filter, fromIssue(write.data), { upsert: true, session });
      } else if (write.action === "upsert") {
        await this.models.Comment.replaceOne(filter, fromComment(write.data), { upsert: true, session });
      } else {
        await this.models.Comment.deleteOne(filter, { session });
      }
    } catch (error) {
      if (duplicateKeyFields(error).includes("_id")) throw new EntityIdTakenError(write.model, write.id);
      throw error;
    }
  }

  private async findMany(
    model: ModelName,
    workspaceId: string,
    ids: string[],
    session: ClientSession,
  ): Promise<Map<string, AnyEntity>> {
    const filter = { _id: { $in: ids }, workspaceId };
    const index = (entities: readonly AnyEntity[]): Map<string, AnyEntity> =>
      new Map(entities.map((entity) => [entity.id, entity]));
    switch (model) {
      case "issue":
        return index((await this.models.Issue.find(filter).session(session).lean<IssueDoc[]>()).map(toIssue));
      case "comment":
        return index((await this.models.Comment.find(filter).session(session).lean<CommentDoc[]>()).map(toComment));
      case "team":
        return index((await this.models.Team.find(filter).session(session).lean<TeamDoc[]>()).map(toTeam));
      case "project":
        return index((await this.models.Project.find(filter).session(session).lean<ProjectDoc[]>()).map(toProject));
      case "label":
        return index((await this.models.Label.find(filter).session(session).lean<LabelDoc[]>()).map(toLabel));
      case "user":
        return index((await this.models.User.find(filter).session(session).lean<UserDoc[]>()).map(toUser));
    }
  }
}
