import { Worker } from "bullmq";
import { loadConfig } from "./config.ts";
import { createLogger } from "./lib/logger.ts";
import { QueueName, createRedis, createSyncQueue, type SyncJobData } from "./lib/queue.ts";
import { guardedFetch } from "./lib/serpapiGuard.ts";
import { loadPlugins } from "./plugins/loader.ts";
import { connectMongo } from "./db/mongo.ts";
import { connectPostgres } from "./db/postgres.ts";
import { createSyncDeps } from "./business/deps.ts";
import { syncBusiness } from "./business/sync.ts";

const config = loadConfig();
const log = createLogger(config);
const redis = createRedis(config);
const connectors = await loadPlugins(config.PLUGINS, { log, fetch: guardedFetch(redis, config) });
const stores = { mongo: await connectMongo(config), pg: await connectPostgres(config) };
const deps = createSyncDeps(config, stores, connectors);

// Make sure every tracked business has its re-sync scheduler (idempotent).
const syncQueue = createSyncQueue(config, redis);
for (const entity of await stores.mongo.entities.find({ tracking: { $exists: true }, source: { $ne: "import" } }).toArray()) {
  await syncQueue.schedule(entity._id);
}

const worker = new Worker<SyncJobData>(QueueName.sync, async (job) => syncBusiness(deps, job.data.entityKey), {
  connection: redis,
  concurrency: config.WORKER_CONCURRENCY,
});

worker.on("completed", (job, result) => log.info({ job: job.id, entity: job.data.entityKey, reason: job.data.reason, result }, "sync completed"));
worker.on("failed", (job, err) => log.error({ job: job?.id, entity: job?.data.entityKey, err: err.message }, "sync failed"));
log.info({ queue: QueueName.sync, concurrency: config.WORKER_CONCURRENCY, sources: [...connectors.keys()] }, "worker started");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    log.info({ signal }, "shutting down worker");
    await worker.close();
    await syncQueue.close();
    await stores.mongo.client.close();
    await stores.pg.end();
    await redis.quit();
    process.exit(0);
  });
}
