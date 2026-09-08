import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { connectMongo } from "./db/connection.js";
import { createLogger } from "./logger.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const connection = await connectMongo(config.mongoUrl, logger);
  const client = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 3 });
  await client.connect();
  const publisher = client.duplicate();
  const subscriber = client.duplicate();
  logger.info("redis connected");

  const server = await buildServer({ config, connection, logger, redis: { client, publisher, subscriber } });
  server.http.listen(config.port, () => logger.info({ port: config.port }, "tracklane api listening"));

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutting down");
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    try {
      await server.close();
      await connection.close();
      await Promise.all([client.quit(), publisher.quit(), subscriber.quit()]);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
