import type { Connection } from "mongoose";
import type { AppConfig } from "./config.js";
import { type Models, registerModels } from "./db/models.js";
import type { Logger } from "./logger.js";
import { CounterRepository } from "./repositories/counter.repository.js";
import { EntityRepository } from "./repositories/entity.repository.js";
import { SyncLogRepository } from "./repositories/sync-log.repository.js";
import { UserRepository } from "./repositories/user.repository.js";
import { WorkspaceRepository } from "./repositories/workspace.repository.js";
import { AccessService } from "./services/access.service.js";
import { AuthService } from "./services/auth.service.js";
import { BootstrapService } from "./services/bootstrap.service.js";
import { CatchUpService } from "./services/catch-up.service.js";
import { MutationService } from "./services/mutation.service.js";
import type { PresenceStore } from "./services/presence.service.js";
import type { RateLimiter } from "./services/rate-limiter.js";
import { MongoTransactionRunner } from "./services/transaction-runner.js";

export interface Services {
  models: Models;
  users: UserRepository;
  workspaces: WorkspaceRepository;
  counters: CounterRepository;
  syncLog: SyncLogRepository;
  auth: AuthService;
  access: AccessService;
  bootstrap: BootstrapService;
  catchUp: CatchUpService;
  mutations: MutationService;
  presence: PresenceStore;
  rateLimiter: RateLimiter;
}

export interface ContainerInput {
  config: AppConfig;
  connection: Connection;
  presence: PresenceStore;
  rateLimiter: RateLimiter;
  logger: Logger;
  clock?: () => Date;
}

export function createServices({ config, connection, presence, rateLimiter, logger, clock }: ContainerInput): Services {
  const models = registerModels(connection);
  const transactions = new MongoTransactionRunner(connection);
  const users = new UserRepository(models);
  const workspaces = new WorkspaceRepository(models);
  const counters = new CounterRepository(models);
  const syncLog = new SyncLogRepository(models);
  const entities = new EntityRepository(models);
  return {
    models,
    users,
    workspaces,
    counters,
    syncLog,
    auth: new AuthService(users, workspaces, config.jwtSecret, config.jwtTtlSeconds),
    access: new AccessService(workspaces),
    bootstrap: new BootstrapService(transactions, workspaces, counters),
    catchUp: new CatchUpService(counters, syncLog, config.catchUpMaxDeltas),
    mutations: new MutationService({
      transactions,
      entities,
      counters,
      syncLog,
      logger: logger.child({ component: "mutations" }),
      ...(clock ? { clock } : {}),
    }),
    presence,
    rateLimiter,
  };
}
