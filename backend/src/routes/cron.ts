import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { enqueueDueSyncs, type Runtime } from "../runtime.ts";

/** Daily re-sync, called by Vercel Cron (vercel.json) with `Authorization: Bearer $CRON_SECRET`. */
export const cronRoutes = (runtime: Runtime): FastifyPluginAsyncZod => async (app) => {
  app.get("/cron/resync", async (request, reply) => {
    const secret = runtime.config.CRON_SECRET;
    if (!secret || request.headers.authorization !== `Bearer ${secret}`) return reply.code(401).send({ message: "Unauthorized" });
    const queued = await enqueueDueSyncs(runtime);
    return { queued };
  });
};
