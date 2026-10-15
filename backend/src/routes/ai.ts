import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { AnalysisReviewInput, AskRequest, SampleDataset, SampleSummary, type AnalysisResult, type StreamEvent } from "@perforvisor/core";
import type { Config } from "../config.ts";
import { checkModelRoles } from "../ai/model.ts";
import type { Mongo } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import { buildAnalyzeGraph, type AnalyzeProgress, type AnalyzeStateValue } from "../ai/graphs/analyze.ts";
import { buildAskGraph, type AskProgress, type AskStateValue } from "../ai/graphs/ask.ts";
import { openSse } from "../lib/sse.ts";
import { samples, sampleSummaries } from "../samples.ts";

type Progress = Extract<StreamEvent, { type: "progress" }>;

/**
 * Runs a compiled graph over SSE: its custom events become progress events,
 * and the final state is turned into the result.
 */
async function streamGraph<State>(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (signal: AbortSignal) => Promise<AsyncIterable<[string, unknown]>>,
  toProgress: (custom: unknown) => Progress,
  toResult: (state: State) => unknown,
) {
  const stream = openSse(request, reply);
  try {
    let final: State | undefined;
    for await (const [mode, chunk] of await run(stream.signal)) {
      if (mode === "custom") stream.send(toProgress(chunk));
      else final = chunk as State;
    }
    if (!final) throw new Error("Run finished without a result");
    stream.send({ type: "result", data: toResult(final) });
    stream.send({ type: "done" });
  } catch (error) {
    if (!stream.closed) {
      request.log.error({ err: error }, "graph run failed");
      stream.send({ type: "error", message: describeError(error) });
    }
  } finally {
    stream.end();
  }
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unexpected error";
  // The OpenAI client reports an unreachable model server as a bare "Connection error."
  if (/connection error|ECONNREFUSED|fetch failed/i.test(message)) {
    return "The AI model server isn't reachable. Start it with `docker compose --profile llm up -d` and try again in a minute.";
  }
  return message;
}

const analyzeProgress = (chunk: unknown): Progress => {
  const p = chunk as AnalyzeProgress;
  if (p.stage === "extract") {
    return { type: "progress", stage: p.stage, message: `Analysed ${p.done} of ${p.total} reviews${p.failed ? ` (${p.failed} failed)` : ""}`, percent: Math.round((p.done / p.total) * 80) };
  }
  return p.stage === "aggregate"
    ? { type: "progress", stage: p.stage, message: "Aggregating results", percent: 85 }
    : { type: "progress", stage: p.stage, message: "Writing advice", percent: 90 };
};

const askProgress = (chunk: unknown): Progress => {
  const p = chunk as AskProgress;
  switch (p.stage) {
    case "index":
      return { type: "progress", stage: p.stage, message: `Indexing ${p.reviews} reviews`, percent: 15 };
    case "retrieve":
      return { type: "progress", stage: p.stage, message: `Reading the ${p.found} most relevant reviews${p.method === "keyword" ? " (keyword search)" : ""}`, percent: 40 };
    default:
      return { type: "progress", stage: p.stage, message: "Writing the answer", percent: 75 };
  }
};

export const aiRoutes = (config: Config, stores: { mongo: Mongo; pg: Postgres }): FastifyPluginAsyncZod => async (app) => {
  const analyzeGraph = buildAnalyzeGraph(config);
  const askGraph = buildAskGraph(config, stores);

  app.get("/ai/health", async (_request, reply) => {
    const roles = await checkModelRoles(config);
    const ok = roles.chat?.ok && roles.embed?.ok;
    return reply.code(ok ? 200 : 503).send(roles);
  });

  app.get("/samples", { schema: { response: { 200: z.array(SampleSummary) } } }, async () => sampleSummaries);

  app.get("/samples/:id", { schema: { params: z.object({ id: z.string() }), response: { 200: SampleDataset } } }, async ({ params }) => {
    const sample = samples.find((s) => s.id === params.id);
    if (!sample) throw app.httpErrors.notFound(`No sample "${params.id}"`);
    return sample;
  });

  // Analyses a batch of reviews and streams progress over SSE.
  app.post(
    "/analyze",
    { schema: { body: z.object({ entityName: z.string().min(1).max(200), reviews: z.array(AnalysisReviewInput).min(1).max(200) }) } },
    (request, reply) =>
      streamGraph<AnalyzeStateValue>(
        request,
        reply,
        (signal) => analyzeGraph.stream(request.body, { streamMode: ["custom", "values"], signal }),
        analyzeProgress,
        (state): AnalysisResult => {
          if (!state.stats) throw new Error("Analysis finished without results");
          return { entityName: state.entityName, stats: state.stats, summary: state.summary ?? null, reviews: state.analyses ?? [] };
        },
      ),
  );

  // Answers a question from a set of reviews, citing the ones it used.
  app.post("/ask", { schema: { body: AskRequest } }, (request, reply) =>
    streamGraph<AskStateValue>(
      request,
      reply,
      (signal) => askGraph.stream(request.body, { streamMode: ["custom", "values"], signal }),
      askProgress,
      (state) => {
        if (!state.result) throw new Error("No answer was produced");
        return state.result;
      },
    ),
  );
};
