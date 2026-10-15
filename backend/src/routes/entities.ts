import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { Entity } from "@perforvisor/core";
import type { Connectors } from "../plugins/loader.ts";

export const entityRoutes = (connectors: Connectors): FastifyPluginAsyncZod => async (app) => {
  app.get("/sources", { schema: { response: { 200: z.array(z.object({ source: z.string(), name: z.string() })) } } }, async () =>
    [...connectors.values()].map(({ manifest }) => ({ source: manifest.source, name: manifest.name })),
  );

  // Finds places or products on a platform. For Google Maps this costs one SerpApi search
  // (cached for SERPAPI_CACHE_HOURS).
  app.get(
    "/search",
    {
      schema: {
        querystring: z.object({ source: z.string(), q: z.string().trim().min(2).max(200) }),
        response: { 200: z.array(Entity.omit({ raw: true })) },
      },
    },
    async ({ query }) => {
      const loaded = connectors.get(query.source);
      if (!loaded) throw app.httpErrors.badRequest(`Unknown or disabled source "${query.source}"`);
      const results = await loaded.connector.search(query.q);
      return results.map(({ raw: _raw, ...entity }) => entity);
    },
  );
};
