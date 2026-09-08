import compression from "compression";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { AppConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { Services } from "../container.js";
import { errorHandler, notFoundHandler, requireAuth } from "./middleware.js";
import { authRoutes } from "./routes/auth.routes.js";
import { issueRoutes } from "./routes/issues.routes.js";
import { syncRoutes } from "./routes/sync.routes.js";

export interface HealthProbe {
  (): Promise<Record<string, "up" | "down">>;
}

export function createApp(config: AppConfig, services: Services, logger: Logger, health: HealthProbe): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: false }));
  app.use(compression());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: { ignore: (req) => req.url === "/healthz" },
      customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info"),
    }),
  );

  app.get("/healthz", async (_req, res) => {
    const checks = await health();
    const healthy = Object.values(checks).every((status) => status === "up");
    res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
  });

  const authenticated = requireAuth(services.auth, services.access);
  app.use(
    "/api/auth",
    authRoutes({
      auth: services.auth,
      users: services.users,
      workspaces: services.workspaces,
      requireAuth: authenticated,
      rateLimiter: services.rateLimiter,
      loginRateLimit: config.loginRateLimit,
      demoWorkspaceSlug: config.demoWorkspaceSlug,
    }),
  );
  app.use("/api/sync", authenticated, syncRoutes({ bootstrap: services.bootstrap, catchUp: services.catchUp }));
  app.use("/api/issues", authenticated, issueRoutes({ workspaces: services.workspaces }));

  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  return app;
}
