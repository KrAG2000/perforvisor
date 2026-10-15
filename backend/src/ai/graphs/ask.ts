import { createHash } from "node:crypto";
import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { AskDraft, type AnalysisReviewInput, type AskResult } from "@perforvisor/core";
import type { Config } from "../../config.ts";
import type { Mongo } from "../../db/mongo.ts";
import type { Postgres } from "../../db/postgres.ts";
import { countReviews, indexReviews, vectorSearch } from "../../retrieval/store.ts";
import { createChatModel } from "../model.ts";
import { rankReviews } from "../retrieve.ts";

export type AskProgress =
  | { stage: "index"; reviews: number }
  | { stage: "retrieve"; found: number; method: "vector" | "keyword" }
  | { stage: "answer" };

const AskState = Annotation.Root({
  question: Annotation<string>,
  /** Either a tracked business's key, or a name plus the reviews to answer from. */
  entityKey: Annotation<string>,
  entityName: Annotation<string>,
  reviews: Annotation<AnalysisReviewInput[]>,
  totalReviews: Annotation<number>,
  method: Annotation<"vector" | "keyword">,
  top: Annotation<AnalysisReviewInput[]>,
  result: Annotation<AskResult | null>,
});
export type AskStateValue = typeof AskState.State;

const ANSWER_PROMPT = `You are Perforvisor. You answer a shopper's question about one place or product using ONLY the customer reviews provided.
The reviews are the ones most similar to the question, but similar is not the same as relevant: some may not address the question at all. Ignore those.
- Answer directly in 2-4 sentences. When it helps, say how many of the provided reviews support the answer.
- Write for a shopper: don't mention review ids in the answer text (they are shown separately as citations).
- If none of the reviews address the question, say so plainly instead of guessing.
- citedReviewIds: the ids of the reviews that actually support your answer, and only those.
Respond with JSON only.`;

// Reviews sent in the request are indexed under a key derived from their content, so
// asking about the same set again reuses the stored embeddings.
const adhocKey = (entityName: string, reviews: AnalysisReviewInput[]) =>
  `adhoc:${createHash("sha256").update(JSON.stringify([entityName, reviews.map((r) => [r.id, r.text, r.rating])])).digest("hex").slice(0, 24)}`;

/**
 * index → retrieve (cosine similarity, top K) → answer.
 * The answer model is also the relevance filter: it reads the top K and cites only the
 * reviews that support its answer. No separate reranker.
 */
/**
 * The model sometimes cites inline ("(r4, r10)", "[p2], [p10], and [p9]") despite the prompt;
 * citations are shown separately, so id lists are removed from the prose.
 */
export function stripReviewIds(answer: string, ids: string[]): string {
  if (!ids.length) return answer;
  const alt = ids
    .map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length)
    .join("|");
  // (?<!\\w)…(?!\\w): whole ids only, so "p2p" or "r2d2" in prose is left alone.
  const one = `[\\[(]?\\s*(?:reviews?\\s+)?(?<!\\w)(?:${alt})(?!\\w)\\s*[\\])]?`;
  const list = new RegExp(`\\s*:?\\s*${one}(?:\\s*(?:,|and|&|,\\s*and)\\s*${one})*`, "gi");
  return answer
    .replace(list, "")
    .replace(/[([]\s*[)\]]/g, "")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function buildAskGraph(config: Config, stores: { mongo: Mongo; pg: Postgres }) {
  const answerer = createChatModel(config, { temperature: 0.2, maxTokens: 400 }).withStructuredOutput(AskDraft, {
    name: "ask_answer",
    method: "jsonSchema",
  });

  const index = async (state: AskStateValue, runConfig: LangGraphRunnableConfig) => {
    // A tracked business is already indexed by its sync.
    if (state.entityKey && !state.reviews?.length) {
      const entity = await stores.mongo.entities.findOne({ _id: state.entityKey }, { projection: { name: 1 } });
      if (!entity) throw new Error(`No business "${state.entityKey}"`);
      return { entityName: entity.name, totalReviews: await countReviews(stores.pg, state.entityKey) };
    }

    const entityKey = adhocKey(state.entityName, state.reviews);
    try {
      if ((await countReviews(stores.pg, entityKey)) < state.reviews.length) {
        runConfig.writer?.({ stage: "index", reviews: state.reviews.length } satisfies AskProgress);
        await indexReviews(
          config,
          stores,
          { _id: entityKey, source: "adhoc", externalId: entityKey, kind: "place", name: state.entityName },
          state.reviews,
          runConfig.signal,
        );
      }
    } catch {
      // Indexing (usually embedding) failed; retrieve falls back to keywords.
    }
    return { entityKey, totalReviews: state.reviews.length };
  };

  const retrieve = async (state: AskStateValue, runConfig: LangGraphRunnableConfig) => {
    try {
      const top = await vectorSearch(config, stores.pg, state.entityKey, state.question, config.ASK_TOP_K, runConfig.signal);
      if (top.length) {
        runConfig.writer?.({ stage: "retrieve", found: top.length, method: "vector" } satisfies AskProgress);
        return { top, method: "vector" as const };
      }
    } catch {
      // Embedding server or database unavailable.
    }
    const reviews = state.reviews?.length ? state.reviews : await stores.mongo.reviews.find({ entityKey: state.entityKey, text: { $ne: "" } }).toArray();
    const top = rankReviews(state.question, reviews, config.ASK_TOP_K).map((r) => r.review);
    runConfig.writer?.({ stage: "retrieve", found: top.length, method: "keyword" } satisfies AskProgress);
    return { top, method: "keyword" as const };
  };

  const answer = async (state: AskStateValue, runConfig: LangGraphRunnableConfig) => {
    runConfig.writer?.({ stage: "answer" } satisfies AskProgress);
    const context = state.top.map((r) => `[${r.id}] (${r.rating ?? "?"}/5) ${r.text}`).join("\n");
    const draft = await answerer.invoke(
      [
        { role: "system", content: ANSWER_PROMPT },
        {
          role: "user",
          content: `Subject: ${state.entityName}. The ${state.top.length} reviews most similar to the question, out of ${state.totalReviews}:\n${context}\n\nQuestion: ${state.question}`,
        },
      ],
      { signal: runConfig.signal },
    );
    // Keep only citations of reviews the model was actually shown.
    const byId = new Map(state.top.map((r) => [r.id, r]));
    const answerText = stripReviewIds(draft.answer, [...byId.keys()]);
    const citations = [...new Set(draft.citedReviewIds)].flatMap((id) => {
      const r = byId.get(id);
      return r ? [{ id: r.id, text: r.text, rating: r.rating, createdAt: r.createdAt }] : [];
    });
    return {
      result: {
        question: state.question,
        answer: answerText,
        citations,
        consideredCount: state.top.length,
        totalReviews: state.totalReviews,
        retrieval: { method: state.method },
      },
    };
  };

  return new StateGraph(AskState)
    .addNode("index", index)
    .addNode("retrieve", retrieve)
    .addNode("answer", answer)
    .addEdge(START, "index")
    .addEdge("index", "retrieve")
    .addEdge("retrieve", "answer")
    .addEdge("answer", END)
    .compile();
}
