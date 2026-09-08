import { loadConfig } from "../config.js";
import { connectMongo } from "../db/connection.js";
import { initModels, registerModels } from "../db/models.js";
import { createLogger } from "../logger.js";
import { DEMO_PASSWORD, users } from "./demo-data.js";
import { seedDemoWorkspace } from "./seed.js";

const config = loadConfig();
const logger = createLogger(config);
const connection = await connectMongo(config.mongoUrl, logger);
try {
  const models = registerModels(connection);
  await initModels(models, { syncLogRetentionDays: config.syncLogRetentionDays });
  // Containers seed on every start; only --force (the local `pnpm seed`) wipes existing data.
  if (!process.argv.includes("--force") && (await models.Workspace.countDocuments()) > 0) {
    logger.info("workspace already seeded; pass --force to reset it");
  } else {
    const summary = await seedDemoWorkspace(models);
    logger.info(summary, "seeded demo workspace");
    logger.info(`sign in as ${users.map((user) => user.email).join(", ")} with password "${DEMO_PASSWORD}"`);
  }
} finally {
  await connection.close();
}
