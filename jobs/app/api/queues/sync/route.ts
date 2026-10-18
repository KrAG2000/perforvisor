import { handleCallback } from "@vercel/queue";
import { handleSyncMessage, type SyncMessage } from "@perforvisor/backend/jobs";

// Vercel Hobby's function limit; a sync run hands off well before it (SYNC_RUN_SECONDS).
export const maxDuration = 300;

// Consumer for the "perforvisor-sync" topic (registered in vercel.json). Acknowledged when
// the handler returns, redelivered when it throws.
export const POST = handleCallback<SyncMessage>(
  async (message) => {
    await handleSyncMessage(message);
  },
  {
    // A business that keeps failing (e.g. its source is gone) stops after 5 attempts; its
    // sync status already records the error for the app.
    retry: (_error, metadata) =>
      metadata.deliveryCount >= 5 ? { acknowledge: true } : { afterSeconds: Math.min(300, 2 ** metadata.deliveryCount * 15) },
  },
);
