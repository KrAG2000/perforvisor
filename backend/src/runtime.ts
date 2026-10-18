import { loadConfig, type Config } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { createJobs, type Jobs, type SyncMessage } from "./lib/jobs.ts";
import { guardedFetch } from "./lib/serpapiGuard.ts";
import { connectMongo, type Mongo } from "./db/mongo.ts";
import { connectPostgres, type Postgres } from "./db/postgres.ts";
import { loadPlugins, type Connectors } from "./plugins/loader.ts";
import { createSyncDeps } from "./business/deps.ts";
import { syncBusiness, type SyncDeps } from "./business/sync.ts";

export interface Runtime {
  config: Config;
  log: ReturnType<typeof createLogger>;
  stores: { mongo: Mongo; pg: Postgres };
  connectors: Connectors;
  jobs: Jobs;
  syncDeps: SyncDeps;
  close(): Promise<void>;
}

/**
 * Runs one sync job. With a time limit (serverless), a run that doesn't finish hands off
 * to a continuation message; every step skips finished work, so nothing is redone.
 */
export async function runSyncJob(runtime: Pick<Runtime, "syncDeps" | "jobs" | "log">, message: SyncMessage, deadline?: number) {
  const result = await syncBusiness(runtime.syncDeps, message.entityKey, { deadline, continuation: message.continuation });
  runtime.log.info({ entity: message.entityKey, reason: message.reason, result }, result.complete ? "sync completed" : "sync continuing");
  if (!result.complete) await runtime.jobs.enqueueSync({ entityKey: message.entityKey, reason: "continuation", continuation: true });
  return result;
}

let shared: Promise<Runtime> | null = null;

/** Connections, plugins and jobs, created once per process (or serverless instance). */
export function getRuntime(): Promise<Runtime> {
  shared ??= (async () => {
    const config = loadConfig();
    const log = createLogger(config);
    const mongo = await connectMongo(config);
    const pg = await connectPostgres(config);
    const stores = { mongo, pg };
    const connectors = await loadPlugins(config.PLUGINS, { log, fetch: guardedFetch(mongo, config) });
    const syncDeps = createSyncDeps(config, stores, connectors);
    const runtime: Runtime = {
      config,
      log,
      stores,
      connectors,
      syncDeps,
      jobs: createJobs(config, (message) => runSyncJob(runtime, message).then(() => undefined), log),
      async close() {
        await mongo.client.close();
        await pg.end();
      },
    };
    return runtime;
  })();
  return shared;
}

/** Queues a sync for every tracked business not synced within SYNC_INTERVAL_HOURS. */
export async function enqueueDueSyncs(runtime: Runtime): Promise<string[]> {
  const cutoff = new Date(Date.now() - runtime.config.SYNC_INTERVAL_HOURS * 3_600_000).toISOString();
  const due = await runtime.stores.mongo.entities
    .find({
      tracking: { $exists: true },
      source: { $ne: "import" },
      "sync.state": { $nin: ["queued", "running"] },
      $or: [{ "sync.finishedAt": { $exists: false } }, { "sync.finishedAt": { $lt: cutoff } }],
    })
    .project<{ _id: string }>({ _id: 1 })
    .toArray();
  for (const { _id } of due) {
    await runtime.stores.mongo.entities.updateOne({ _id }, { $set: { "sync.state": "queued", "sync.message": "Waiting to sync" } });
    await runtime.jobs.enqueueSync({ entityKey: _id, reason: "scheduled" });
  }
  return due.map((d) => d._id);
}
