import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  BusinessDetail,
  BusinessSummary,
  Comparison,
  ImportRequest,
  KnowledgeGraph,
  ReviewItem,
  TrackRequest,
  Trends,
} from "@perforvisor/core";
import type { Mongo } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import type { BusinessService } from "../business/service.ts";
import { NotFoundError } from "../business/service.ts";
import { readTrends } from "../business/trends.ts";
import { readGraph } from "../business/graph.ts";
import { openSse } from "../lib/sse.ts";

const Key = z.object({ key: z.string().min(1) });

export const businessRoutes =
  (
    service: BusinessService,
    stores: { mongo: Mongo; pg: Postgres },
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.setErrorHandler((error, _request, reply) => {
      if (error instanceof NotFoundError)
        return reply
          .code(404)
          .send({
            statusCode: 404,
            error: "Not Found",
            message: error.message,
          });
      return reply.send(error);
    });

    app.get(
      "/businesses",
      { schema: { response: { 200: z.array(BusinessSummary) } } },
      () => service.list(),
    );
    app.post(
      "/businesses",
      { schema: { body: TrackRequest, response: { 200: BusinessDetail } } },
      ({ body }) => service.track(body),
    );
    app.post(
      "/businesses/import",
      { schema: { body: ImportRequest, response: { 200: BusinessDetail } } },
      ({ body }) => service.importReviews(body),
    );
    app.get(
      "/businesses/:key",
      { schema: { params: Key, response: { 200: BusinessDetail } } },
      ({ params }) => service.detail(params.key),
    );
    app.delete(
      "/businesses/:key",
      { schema: { params: Key } },
      async ({ params }, reply) => {
        await service.untrack(params.key);
        return reply.code(204).send();
      },
    );
    app.post(
      "/businesses/:key/sync",
      { schema: { params: Key, response: { 200: BusinessDetail } } },
      ({ params }) => service.sync(params.key),
    );

    // Streams sync progress (from the worker, via the entity's sync status) until it finishes.
    app.get(
      "/businesses/:key/sync/events",
      { schema: { params: Key } },
      async (request, reply) => {
        await service.status(request.params.key);
        const stream = openSse(request, reply);
        let last = "";
        const deadline = Date.now() + 15 * 60_000;
        try {
          while (!stream.closed && Date.now() < deadline) {
            const status = await service.status(request.params.key);
            const snapshot = JSON.stringify(status);
            if (snapshot !== last) {
              last = snapshot;
              if (status.state === "error") {
                stream.send({
                  type: "error",
                  message: status.error ?? "Sync failed",
                });
                break;
              }
              stream.send({
                type: "progress",
                stage: status.stage ?? status.state,
                message: status.message ?? status.state,
                percent: status.percent,
              });
              if (status.state === "done" || status.state === "idle") {
                stream.send({
                  type: "result",
                  data: await service.detail(request.params.key),
                });
                stream.send({ type: "done" });
                break;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } finally {
          stream.end();
        }
      },
    );

    app.get(
      "/businesses/:key/reviews",
      {
        schema: {
          params: Key,
          querystring: z.object({
            filter: z.enum(["all", "suspicious", "negative"]).default("all"),
          }),
          response: { 200: z.array(ReviewItem) },
        },
      },
      ({ params, query }) => service.reviews(params.key, query.filter),
    );

    app.get(
      "/businesses/:key/trends",
      { schema: { params: Key, response: { 200: Trends } } },
      async ({ params }) => {
        await service.status(params.key);
        return readTrends(stores.pg, params.key);
      },
    );

    app.get(
      "/businesses/:key/graph",
      { schema: { params: Key, response: { 200: KnowledgeGraph } } },
      async ({ params }) => {
        await service.status(params.key);
        return readGraph(
          stores.mongo,
          params.key,
          await stores.mongo.reports.findOne({ _id: params.key }),
        );
      },
    );

    app.get(
      "/businesses/:key/compare",
      { schema: { params: Key, response: { 200: Comparison } } },
      ({ params }) => service.compare(params.key),
    );
  };
