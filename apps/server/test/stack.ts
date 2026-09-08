import type { AddressInfo } from "node:net";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose, { type Connection } from "mongoose";
import { type Socket, io } from "socket.io-client";
import type { AppConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { type RunningServer, buildServer } from "../src/server.js";
import { DEMO_PASSWORD } from "../src/seed/demo-data.js";
import { type SeedSummary, seedDemoWorkspace } from "../src/seed/seed.js";

export interface TestStack {
  url: string;
  server: RunningServer;
  connection: Connection;
  seed: SeedSummary;
  login(email: string): Promise<{ token: string; userId: string }>;
  socket(token: string): Promise<Socket>;
  reseed(): Promise<void>;
  close(): Promise<void>;
}

export const TEST_JWT_SECRET = "test-secret-that-is-definitely-long-enough";

export async function startStack(overrides: Partial<AppConfig> = {}): Promise<TestStack> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  const config: AppConfig = {
    env: "test",
    port: 0,
    mongoUrl: replSet.getUri("tracklane-test"),
    redisUrl: "",
    jwtSecret: TEST_JWT_SECRET,
    corsOrigins: ["http://localhost:3110"],
    logLevel: "silent",
    syncLogRetentionDays: 14,
    catchUpMaxDeltas: 1_000,
    presenceTtlSeconds: 30,
    jwtTtlSeconds: 3_600,
    accessRefreshMs: 60_000,
    loginRateLimit: { max: 1_000, windowSeconds: 60 },
    demoWorkspaceSlug: "lumen",
    ...overrides,
  };
  const logger = createLogger(config);
  const connection = await mongoose.createConnection(config.mongoUrl).asPromise();
  const server = await buildServer({ config, connection, logger });
  let seed = await seedDemoWorkspace(server.services.models);
  await new Promise<void>((resolve) => server.http.listen(0, "127.0.0.1", resolve));
  const { port } = server.http.address() as AddressInfo;
  const url = `http://127.0.0.1:${port}`;
  const sockets: Socket[] = [];

  return {
    url,
    server,
    connection,
    get seed() {
      return seed;
    },
    async login(email) {
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: DEMO_PASSWORD }),
      });
      const body = (await response.json()) as { token: string; user: { id: string } };
      return { token: body.token, userId: body.user.id };
    },
    async socket(token) {
      const socket = io(url, { auth: { token }, transports: ["websocket"], reconnection: false });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("connect_error", reject);
      });
      return socket;
    },
    async reseed() {
      seed = await seedDemoWorkspace(server.services.models);
    },
    async close() {
      sockets.forEach((socket) => socket.disconnect());
      await server.close();
      await connection.close();
      await replSet.stop();
    },
  };
}
