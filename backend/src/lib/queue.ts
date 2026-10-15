import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Config } from "../config.ts";

export const QueueName = {
  sync: "sync",
} as const;

export interface SyncJobData {
  entityKey: string;
  reason: "added" | "manual" | "scheduled";
}

/**
 * BullMQ 6 needs a ready-made client under ESM. maxRetriesPerRequest must be null
 * so workers' blocking commands are never cut off. BullMQ does not close clients
 * it was given, so callers must quit() them on shutdown.
 */
export const createRedis = (config: Config) => new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

export function createSyncQueue(config: Config, redis: Redis) {
  const queue = new Queue<SyncJobData>(QueueName.sync, { connection: redis });
  const schedulerId = (entityKey: string) => `resync:${entityKey}`;

  return {
    queue,
    /** At most one queued sync per business: a second request while one is pending is ignored. */
    enqueue: (entityKey: string, reason: SyncJobData["reason"]) =>
      queue.add("sync", { entityKey, reason }, { deduplication: { id: entityKey }, attempts: 2, backoff: { type: "exponential", delay: 30_000 }, removeOnComplete: 200, removeOnFail: 200 }),
    async schedule(entityKey: string) {
      if (config.SYNC_INTERVAL_HOURS <= 0) return;
      await queue.upsertJobScheduler(schedulerId(entityKey), { every: config.SYNC_INTERVAL_HOURS * 3_600_000 }, { name: "sync", data: { entityKey, reason: "scheduled" } });
    },
    unschedule: (entityKey: string) => queue.removeJobScheduler(schedulerId(entityKey)),
    close: () => queue.close(),
  };
}

export type SyncQueue = ReturnType<typeof createSyncQueue>;
