import { z } from "zod";

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

// Secrets that ship in docs and examples; fine for a laptop, never for production.
const PLACEHOLDER_SECRETS = new Set([
  "change-me-to-a-long-random-string-of-48-chars",
  "local-compose-secret-change-me-0123456789abcdef",
  "test-secret-that-is-definitely-long-enough",
]);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8110),
  MONGO_URL: z.string().min(1).default("mongodb://127.0.0.1:27110/tracklane?replicaSet=rs0"),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6410"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CORS_ORIGIN: z.string().default("http://localhost:3110"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SYNC_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(14),
  CATCHUP_MAX_DELTAS: z.coerce.number().int().positive().default(5_000),
  PRESENCE_TTL_SECONDS: z.coerce.number().int().positive().default(30),
  JWT_TTL_SECONDS: z.coerce.number().int().positive().default(24 * 60 * 60),
  ACCESS_REFRESH_SECONDS: z.coerce.number().int().positive().default(60),
  LOGIN_RATE_LIMIT: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  DEMO_MODE: booleanFlag.default(false),
  DEMO_WORKSPACE_SLUG: z.string().min(1).default("lumen"),
});

export interface AppConfig {
  env: "development" | "test" | "production";
  port: number;
  mongoUrl: string;
  redisUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  logLevel: z.infer<typeof EnvSchema>["LOG_LEVEL"];
  syncLogRetentionDays: number;
  catchUpMaxDeltas: number;
  presenceTtlSeconds: number;
  jwtTtlSeconds: number;
  accessRefreshMs: number;
  loginRateLimit: { max: number; windowSeconds: number };
  /** Set only when demo mode is on: the one workspace whose accounts the sign-in screen may list. */
  demoWorkspaceSlug: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `  ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && PLACEHOLDER_SECRETS.has(e.JWT_SECRET)) {
    throw new Error("Invalid environment:\n  JWT_SECRET: replace the example secret before running in production");
  }
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    mongoUrl: e.MONGO_URL,
    redisUrl: e.REDIS_URL,
    jwtSecret: e.JWT_SECRET,
    corsOrigins: e.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean),
    logLevel: e.LOG_LEVEL,
    syncLogRetentionDays: e.SYNC_LOG_RETENTION_DAYS,
    catchUpMaxDeltas: e.CATCHUP_MAX_DELTAS,
    presenceTtlSeconds: e.PRESENCE_TTL_SECONDS,
    jwtTtlSeconds: e.JWT_TTL_SECONDS,
    accessRefreshMs: e.ACCESS_REFRESH_SECONDS * 1_000,
    loginRateLimit: { max: e.LOGIN_RATE_LIMIT, windowSeconds: e.LOGIN_RATE_WINDOW_SECONDS },
    demoWorkspaceSlug: e.DEMO_MODE ? e.DEMO_WORKSPACE_SLUG : null,
  };
}
