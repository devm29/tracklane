import { socketEvents } from "@tracklane/domain";
import type { mongo } from "mongoose";
import type { Models, SyncActionDoc } from "../db/models.js";
import type { Logger } from "../logger.js";
import { toDelta } from "../repositories/sync-log.repository.js";
import { type SyncServer, teamRoom } from "./socket-types.js";

const RESTART_DELAY_MS = 1_000;

/**
 * Tails the sync log and pushes each committed delta to the sockets of its
 * team that are connected to this process. Every API instance runs one, so
 * `io.local` is used to avoid re-broadcasting through the Redis adapter.
 */
export class DeltaPublisher {
  private stream: mongo.ChangeStream<SyncActionDoc, mongo.ChangeStreamDocument<SyncActionDoc>> | null = null;
  private resumeToken: unknown = null;
  private stopped = false;
  /** Restarts only make sense once start() has succeeded; before that, start() reports the failure itself. */
  private running = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly models: Models,
    private readonly io: SyncServer,
    private readonly logger: Logger,
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    const stream = this.open();
    // Mongoose wraps the driver stream and signals "ready" once the cursor is
    // open; the driver typings don't know about that event.
    const events = stream as unknown as NodeJS.EventEmitter;
    try {
      await new Promise<void>((resolve, reject) => {
        events.once("ready", () => resolve());
        events.once("error", reject);
      });
    } catch (error) {
      this.stopped = true;
      this.stream = null;
      throw error;
    }
    this.running = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.running = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    await this.stream?.close();
    this.stream = null;
  }

  private open(): mongo.ChangeStream<SyncActionDoc, mongo.ChangeStreamDocument<SyncActionDoc>> {
    const stream = this.models.SyncAction.watch<SyncActionDoc, mongo.ChangeStreamDocument<SyncActionDoc>>(
      [{ $match: { operationType: "insert" } }],
      this.resumeToken ? { resumeAfter: this.resumeToken } : {},
    );
    this.stream = stream;
    stream.on("change", (change) => {
      this.resumeToken = change._id;
      if (change.operationType !== "insert") return;
      try {
        const doc = change.fullDocument;
        const delta = toDelta(doc);
        this.io.local.to(teamRoom(doc.workspaceId, doc.teamId)).emit(socketEvents.delta, delta);
      } catch (error) {
        this.logger.error({ err: error }, "failed to publish delta");
      }
    });
    stream.on("error", (error) => {
      this.logger.error({ err: error }, "sync log change stream failed; restarting");
      void stream.close();
      if (this.stopped || !this.running) return;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        if (!this.stopped) this.open();
      }, RESTART_DELAY_MS);
    });
    return stream;
  }
}
