import type { Config } from "../config.ts";

/** Topic the jobs service consumes (see jobs/ and vercel.json). */
export const SYNC_TOPIC = "perforvisor-sync";

export interface SyncMessage {
  entityKey: string;
  reason: "added" | "manual" | "scheduled" | "continuation";
  /** Set on hand-offs from a run that hit its time limit: skip fetching, keep going. */
  continuation?: boolean;
}

export interface Jobs {
  enqueueSync(message: SyncMessage): Promise<void>;
}

type Logger = { error(obj: object, msg?: string): void };

/**
 * Where syncs run. "inline": in this process, at most one per business at a time (local
 * dev; no queue service needed). "vercel": published to Vercel Queues, delivered to the
 * jobs service with retries.
 */
export function createJobs(config: Config, runInline: (message: SyncMessage) => Promise<void>, log: Logger): Jobs {
  if (config.JOBS_DRIVER === "vercel") {
    return {
      async enqueueSync(message) {
        const { send } = await import("@vercel/queue");
        // One message per business per minute and reason: double-clicks and overlapping
        // crons collapse into one sync.
        const minute = Math.floor(Date.now() / 60_000);
        await send(SYNC_TOPIC, message, { idempotencyKey: `${message.entityKey}:${message.reason}:${minute}` });
      },
    };
  }

  const running = new Set<string>();
  const rerun = new Map<string, SyncMessage>();
  const start = (message: SyncMessage) => {
    running.add(message.entityKey);
    void runInline(message)
      .catch((err: unknown) => log.error({ err, entity: message.entityKey }, "inline sync failed"))
      .finally(() => {
        running.delete(message.entityKey);
        const next = rerun.get(message.entityKey);
        if (next) {
          rerun.delete(message.entityKey);
          start(next);
        }
      });
  };
  return {
    async enqueueSync(message) {
      if (running.has(message.entityKey)) rerun.set(message.entityKey, message);
      else start(message);
    },
  };
}
