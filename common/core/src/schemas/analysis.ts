import { z } from "zod";

/** Fixed list so small models stay consistent and results aggregate across reviews. */
export const Aspect = z.enum([
  "quality",
  "value",
  "service",
  "staff",
  "food",
  "taste",
  "ambience",
  "cleanliness",
  "wait_time",
  "delivery",
  "packaging",
  "durability",
  "performance",
  "authenticity",
  "other",
]);
export type Aspect = z.infer<typeof Aspect>;

export const Sentiment = z.enum(["positive", "neutral", "negative"]);
export type Sentiment = z.infer<typeof Sentiment>;

/** What the model extracts from one review. */
export const ReviewExtraction = z.object({
  sentiment: Sentiment.describe("Overall sentiment of the review text"),
  aspects: z
    .array(z.object({ aspect: Aspect, sentiment: Sentiment }))
    .max(6)
    .describe("Aspects the review talks about, each with its own sentiment"),
  claims: z
    .array(z.object({ text: z.string().max(120), aspect: Aspect }))
    .max(5)
    .describe("Short, specific factual claims made by the reviewer, e.g. 'battery overheats after an hour', each with the aspect it is about"),
});
export type ReviewExtraction = z.infer<typeof ReviewExtraction>;

/** A review as the analysis flow receives it. */
export const AnalysisReviewInput = z.object({
  id: z.string(),
  text: z.string().min(1).max(4000),
  rating: z.number().min(0).max(5).optional(),
  createdAt: z.iso.datetime().optional(),
});
export type AnalysisReviewInput = z.infer<typeof AnalysisReviewInput>;

export const ReviewAnalysis = ReviewExtraction.extend({
  reviewId: z.string(),
  /** Set when the star rating and the text's sentiment disagree. */
  ratingMismatch: z.boolean(),
});
export type ReviewAnalysis = z.infer<typeof ReviewAnalysis>;

export const AspectStat = z.object({
  aspect: Aspect,
  mentions: z.number().int(),
  positive: z.number().int(),
  neutral: z.number().int(),
  negative: z.number().int(),
  /** (positive - negative) / mentions, from -1 to 1. */
  score: z.number(),
});
export type AspectStat = z.infer<typeof AspectStat>;

export const ClaimCount = z.object({ claim: z.string(), count: z.number().int() });
export type ClaimCount = z.infer<typeof ClaimCount>;

export const AnalysisStats = z.object({
  reviewCount: z.number().int(),
  analysedCount: z.number().int(),
  failedCount: z.number().int(),
  averageRating: z.number().nullable(),
  sentiment: z.object({ positive: z.number().int(), neutral: z.number().int(), negative: z.number().int() }),
  aspects: z.array(AspectStat),
  topClaims: z.array(ClaimCount),
  /** Claims from positive and negative reviews, excluding suspicious ones. */
  praise: z.array(ClaimCount),
  complaints: z.array(ClaimCount),
  /** Reviews left out of praise and complaints: rating mismatches and all but one of each duplicate group. */
  suspiciousReviewIds: z.array(z.string()),
  ratingMismatches: z.array(z.string()).describe("Review ids whose rating contradicts their text"),
  duplicateGroups: z.array(z.array(z.string())).describe("Groups of review ids with near-identical text"),
});
export type AnalysisStats = z.infer<typeof AnalysisStats>;

/**
 * What the model writes. Kept small on purpose: deciding what counts as a strength
 * or weakness is done in code, which small models get wrong.
 */
export const AdvisorDraft = z.object({
  verdict: z.string().describe("One or two sentences, under 40 words, on how this place or product is performing"),
  actions: z.array(z.string()).max(3).describe("Concrete things the owner should do next, most important first"),
});
export type AdvisorDraft = z.infer<typeof AdvisorDraft>;

export const AdvisorSummary = AdvisorDraft.extend({
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
});
export type AdvisorSummary = z.infer<typeof AdvisorSummary>;

export const AnalysisResult = z.object({
  entityName: z.string(),
  stats: AnalysisStats,
  summary: AdvisorSummary.nullable(),
  reviews: z.array(ReviewAnalysis),
});
export type AnalysisResult = z.infer<typeof AnalysisResult>;
