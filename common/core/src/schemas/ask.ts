import { z } from "zod";
import { AnalysisReviewInput } from "./analysis.ts";

/** Ask about a tracked business (by key), or about reviews sent with the question. */
export const AskRequest = z.union([
  z.object({ question: z.string().trim().min(3).max(500), entityKey: z.string().min(1) }),
  z.object({ question: z.string().trim().min(3).max(500), entityName: z.string().min(1).max(200), reviews: z.array(AnalysisReviewInput).min(1).max(500) }),
]);
export type AskRequest = z.infer<typeof AskRequest>;

/** What the model writes; citations are checked against the reviews it was shown. */
export const AskDraft = z.object({
  answer: z.string().describe("Direct answer to the question in 2-4 sentences, based only on the reviews"),
  citedReviewIds: z.array(z.string()).max(5).describe("Ids of the reviews that support the answer"),
});
export type AskDraft = z.infer<typeof AskDraft>;

export const AskResult = z.object({
  question: z.string(),
  answer: z.string(),
  citations: z.array(AnalysisReviewInput),
  /** How many reviews were relevant enough to show the model. */
  consideredCount: z.number().int(),
  totalReviews: z.number().int(),
  /** How the reviews shown to the model were chosen: cosine similarity, or keywords if embeddings were unavailable. */
  retrieval: z.object({ method: z.enum(["vector", "keyword"]) }),
});
export type AskResult = z.infer<typeof AskResult>;
