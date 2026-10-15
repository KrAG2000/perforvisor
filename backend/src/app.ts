import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import type { Config } from "./config.ts";
import { loggerOptions } from "./lib/logger.ts";
import { loadPlugins } from "./plugins/loader.ts";
import { healthRoutes } from "./routes/health.ts";
import { entityRoutes } from "./routes/entities.ts";
import { aiRoutes } from "./routes/ai.ts";
import { connectMongo } from "./db/mongo.ts";
import { connectPostgres } from "./db/postgres.ts";
import { businessRoutes } from "./routes/business.ts";
import { createBusinessService } from "./business/service.ts";
import { createGraphBuilder } from "./business/graph.ts";
import { createRedis, createSyncQueue } from "./lib/queue.ts";
import { guardedFetch, serpApiUsage } from "./lib/serpapiGuard.ts";

export async function buildApp(config: Config) {
  const app = Fastify({ logger: loggerOptions(config) }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, { origin: config.CORS_ORIGINS });

  const redis = createRedis(config);
  const connectors = await loadPlugins(config.PLUGINS, { log: app.log, fetch: guardedFetch(redis, config) });
  const stores = { mongo: await connectMongo(config), pg: await connectPostgres(config) };
  const queue = createSyncQueue(config, redis);
  const businesses = createBusinessService({ ...stores, queue, graph: createGraphBuilder(config, stores) });
  app.addHook("onClose", async () => {
    await queue.close();
    await stores.mongo.client.close();
    await stores.pg.end();
    await redis.quit();
  });

  await app.register(healthRoutes);
  await app.register(entityRoutes(connectors), { prefix: "/v1" });
  await app.register(aiRoutes(config, stores), { prefix: "/v1" });
  await app.register(businessRoutes(businesses, stores), { prefix: "/v1" });
  app.get("/v1/usage/serpapi", () => serpApiUsage(redis, config));

  return app;
}
