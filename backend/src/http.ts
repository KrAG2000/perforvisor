import Fastify from "fastify";
import cors from "@fastify/cors";
import sensible from "@fastify/sensible";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { loggerOptions } from "./lib/logger.ts";
import { serpApiUsage } from "./lib/serpapiGuard.ts";
import { healthRoutes } from "./routes/health.ts";
import { entityRoutes } from "./routes/entities.ts";
import { aiRoutes } from "./routes/ai.ts";
import { businessRoutes } from "./routes/business.ts";
import { cronRoutes } from "./routes/cron.ts";
import { createBusinessService } from "./business/service.ts";
import { createGraphBuilder } from "./business/graph.ts";
import type { Runtime } from "./runtime.ts";

export async function buildApp(runtime: Runtime) {
  const { config, stores, connectors, jobs } = runtime;
  const app = Fastify({
    logger: loggerOptions(config),
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(sensible);
  await app.register(cors, { origin: config.CORS_ORIGINS });

  const businesses = createBusinessService({
    ...stores,
    jobs,
    graph: createGraphBuilder(config, stores),
  });

  await app.register(healthRoutes);
  await app.register(entityRoutes(connectors), { prefix: "/v1" });
  await app.register(aiRoutes(config, stores), { prefix: "/v1" });
  await app.register(businessRoutes(businesses, stores), { prefix: "/v1" });
  await app.register(cronRoutes(runtime), { prefix: "/v1" });
  app.get("/v1/usage/serpapi", () => serpApiUsage(stores.mongo, config));

  return app;
}
