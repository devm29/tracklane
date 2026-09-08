import type { ClientSession, Connection, mongo } from "mongoose";

type TransactionOptions = mongo.TransactionOptions;

export interface TransactionRunner {
  run<T>(work: (session: ClientSession) => Promise<T>, options?: TransactionOptions): Promise<T>;
}

/**
 * Wraps `withTransaction`, which retries the whole callback on transient
 * errors such as write conflicts on the workspace counter. Callbacks must
 * therefore be safe to re-run from scratch.
 */
export class MongoTransactionRunner implements TransactionRunner {
  constructor(private readonly connection: Connection) {}

  async run<T>(work: (session: ClientSession) => Promise<T>, options?: TransactionOptions): Promise<T> {
    const session = await this.connection.startSession();
    try {
      let result: { value: T } | undefined;
      await session.withTransaction(async () => {
        result = { value: await work(session) };
      }, options);
      if (!result) throw new Error("Transaction finished without a result");
      return result.value;
    } finally {
      await session.endSession();
    }
  }
}
