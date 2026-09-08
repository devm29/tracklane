import { createServer, type Server as HttpServer } from "node:http";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Redis } from "ioredis";
import mongoose, { type Connection } from "mongoose";
import { Server } from "socket.io";
import type { AppConfig } from "./config.js";
import { type Services, createServices } from "./container.js";
import { initModels } from "./db/models.js";
import { createApp } from "./http/app.js";
import type { Logger } from "./logger.js";
import { DeltaPublisher } from "./realtime/delta-publisher.js";
import { attachSocketGateway } from "./realtime/socket-gateway.js";
import type { SyncServer } from "./realtime/socket-types.js";
import { MemoryPresenceStore, RedisPresenceStore } from "./services/presence.service.js";
import { MemoryRateLimiter, RedisRateLimiter } from "./services/rate-limiter.js";

export interface RunningServer {
  http: HttpServer;
  io: SyncServer;
  services: Services;
  close(): Promise<void>;
}

export interface ServerInput {
  config: AppConfig;
  connection: Connection;
  logger: Logger;
  /** Redis clients for presence and the Socket.IO adapter; without them presence is per-process. */
  redis?: { client: Redis; publisher: Redis; subscriber: Redis };
  clock?: () => Date;
}

export async function buildServer(input: ServerInput): Promise<RunningServer> {
  const { config, connection, logger, redis } = input;
  const presence = redis ? new RedisPresenceStore(redis.client) : new MemoryPresenceStore();
  const rateLimiter = redis ? new RedisRateLimiter(redis.client) : new MemoryRateLimiter();
  const services = createServices({
    config,
    connection,
    presence,
    rateLimiter,
    logger,
    ...(input.clock ? { clock: input.clock } : {}),
  });
  await initModels(services.models, { syncLogRetentionDays: config.syncLogRetentionDays });
  await services.counters.backfillEpochs();

  const health = async (): Promise<Record<string, "up" | "down">> => {
    const checks: Record<string, "up" | "down"> = { mongo: connection.readyState === mongoose.ConnectionStates.connected ? "up" : "down" };
    if (redis) checks.redis = await redis.client.ping().then(() => "up" as const, () => "down" as const);
    return checks;
  };

  const app = createApp(config, services, logger, health);
  const http = createServer(app);
  const io: SyncServer = new Server(http, {
    cors: { origin: config.corsOrigins },
    serveClient: false,
    ...(redis ? { adapter: createAdapter(redis.publisher, redis.subscriber) } : {}),
  });

  attachSocketGateway(io, {
    auth: services.auth,
    access: services.access,
    mutations: services.mutations,
    catchUp: services.catchUp,
    presence: services.presence,
    workspaces: services.workspaces,
    presenceTtlMs: config.presenceTtlSeconds * 1_000,
    accessRefreshMs: config.accessRefreshMs,
    logger: logger.child({ component: "socket" }),
  });

  const publisher = new DeltaPublisher(services.models, io, logger.child({ component: "delta-publisher" }));
  await publisher.start();

  return {
    http,
    io,
    services,
    async close() {
      await publisher.stop();
      await io.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
