import { pino, type Logger } from "pino";
import type { AppConfig } from "./config.js";

export type { Logger };

export function createLogger(config: Pick<AppConfig, "env" | "logLevel">): Logger {
  return pino({
    level: config.logLevel,
    base: { service: "tracklane-api" },
    redact: { paths: ["req.headers.authorization", "password", "token"], remove: true },
    ...(config.env === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" } } }
      : {}),
  });
}
