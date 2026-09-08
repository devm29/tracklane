import mongoose, { type Connection } from "mongoose";
import type { Logger } from "../logger.js";

export async function connectMongo(url: string, logger: Logger): Promise<Connection> {
  const connection = mongoose.createConnection(url, { serverSelectionTimeoutMS: 10_000 });
  connection.on("disconnected", () => logger.warn("mongo disconnected"));
  connection.on("reconnected", () => logger.info("mongo reconnected"));
  await connection.asPromise();
  logger.info({ db: connection.name }, "mongo connected");
  return connection;
}
