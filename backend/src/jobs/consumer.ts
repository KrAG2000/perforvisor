import { getRuntime, runSyncJob } from "../runtime.ts";
import type { SyncMessage } from "../lib/jobs.ts";

export type { SyncMessage } from "../lib/jobs.ts";

/**
 * Handles one Vercel Queues sync message (called by the jobs service). The run stops at
 * SYNC_RUN_SECONDS and hands off to a continuation, keeping inside the function limit.
 * Throwing makes Vercel Queues redeliver the message.
 */
export async function handleSyncMessage(message: SyncMessage) {
  const runtime = await getRuntime();
  await runSyncJob(runtime, message, Date.now() + runtime.config.SYNC_RUN_SECONDS * 1000);
}
