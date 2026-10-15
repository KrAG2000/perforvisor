import { z } from "zod";
import { AdvisorSummary, AnalysisReviewInput, AnalysisStats, Aspect, Sentiment } from "./analysis.ts";
import { Entity, EntityKind } from "./entity.ts";

/** A tracked place or product: the owner's own, or a competitor of one of theirs. */
export const TrackRole = z.enum(["business", "competitor"]);
export type TrackRole = z.infer<typeof TrackRole>;

export const SyncState = z.enum(["idle", "queued", "running", "done", "error"]);

export const SyncStatus = z.object({
  state: SyncState,
  stage: z.string().optional(),
  message: z.string().optional(),
  percent: z.number().min(0).max(100).optional(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  error: z.string().optional(),
  /** Newest review seen; re-syncs fetch only reviews after it. */
  lastReviewAt: z.iso.datetime().optional(),
});
export type SyncStatus = z.infer<typeof SyncStatus>;

export const BusinessSummary = z.object({
  key: z.string(),
  source: z.string(),
  kind: EntityKind,
  name: z.string(),
  category: z.string().optional(),
  address: z.string().optional(),
  url: z.string().optional(),
  /** Rating and review count as shown on the platform (all reviews, not just synced ones). */
  platformRating: z.number().optional(),
  platformReviewCount: z.number().int().optional(),
  role: TrackRole,
  competitorOf: z.string().optional(),
  addedAt: z.iso.datetime(),
  sync: SyncStatus,
  storedReviews: z.number().int(),
  analysedReviews: z.number().int(),
  headline: z
    .object({ averageRating: z.number().nullable(), positiveShare: z.number(), suspicious: z.number().int(), generatedAt: z.iso.datetime() })
    .optional(),
});
export type BusinessSummary = z.infer<typeof BusinessSummary>;

export const BusinessReport = z.object({
  key: z.string(),
  stats: AnalysisStats,
  summary: AdvisorSummary.nullable(),
  generatedAt: z.iso.datetime(),
});
export type BusinessReport = z.infer<typeof BusinessReport>;

export const BusinessDetail = z.object({ business: BusinessSummary, report: BusinessReport.nullable() });
export type BusinessDetail = z.infer<typeof BusinessDetail>;

/** Start tracking an entity found through a connector's search. */
export const TrackRequest = z.object({
  entity: Entity.omit({ raw: true }),
  role: TrackRole.default("business"),
  competitorOf: z.string().optional(),
});
export type TrackRequest = z.input<typeof TrackRequest>;

/** Start tracking reviews the owner pastes or exports from a platform without an API. */
export const ImportRequest = z.object({
  name: z.string().trim().min(1).max(200),
  kind: EntityKind.default("place"),
  category: z.string().trim().max(100).optional(),
  reviews: z.array(AnalysisReviewInput).min(1).max(1000),
  role: TrackRole.default("business"),
  competitorOf: z.string().optional(),
});
export type ImportRequest = z.input<typeof ImportRequest>;

export const ReviewItem = AnalysisReviewInput.extend({
  sentiment: Sentiment.optional(),
  /** Why the review looks suspicious, if it does. */
  flags: z.array(z.string()),
});
export type ReviewItem = z.infer<typeof ReviewItem>;

export const TrendPoint = z.object({
  bucket: z.iso.datetime(),
  reviews: z.number().int(),
  averageRating: z.number().nullable(),
  positive: z.number().int(),
  neutral: z.number().int(),
  negative: z.number().int(),
});
export type TrendPoint = z.infer<typeof TrendPoint>;

export const Burst = z.object({
  day: z.iso.datetime(),
  reviews: z.number().int(),
  /** Typical reviews per day around this one (median). */
  typical: z.number(),
  averageRating: z.number().nullable(),
  kind: z.enum(["volume", "five_star", "one_star"]),
});
export type Burst = z.infer<typeof Burst>;

export const Trends = z.object({
  bucket: z.enum(["day", "week", "month"]),
  points: z.array(TrendPoint),
  bursts: z.array(Burst),
  /** Oldest and newest review dates in the synced data. */
  range: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).nullable(),
});
export type Trends = z.infer<typeof Trends>;

/** A claim node in the knowledge graph: similar claims from different reviews merged into one. */
export const GraphClaim = z.object({
  id: z.string(),
  text: z.string(),
  sentiment: Sentiment,
  aspect: Aspect.optional(),
  count: z.number().int(),
  reviewIds: z.array(z.string()),
  /** Other wordings merged into this claim. */
  variants: z.array(z.string()),
  firstSeen: z.iso.datetime().optional(),
  lastSeen: z.iso.datetime().optional(),
});
export type GraphClaim = z.infer<typeof GraphClaim>;

export const KnowledgeGraph = z.object({
  aspects: z.array(z.object({ aspect: Aspect, mentions: z.number().int(), score: z.number(), claims: z.array(GraphClaim) })),
  nodes: z.number().int(),
  edges: z.number().int(),
});
export type KnowledgeGraph = z.infer<typeof KnowledgeGraph>;

export const Comparison = z.object({
  businesses: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      role: TrackRole,
      averageRating: z.number().nullable(),
      analysedReviews: z.number().int(),
      aspects: z.record(z.string(), z.object({ score: z.number(), mentions: z.number().int() })),
      topPraise: z.array(z.string()),
      topComplaints: z.array(z.string()),
    }),
  ),
});
export type Comparison = z.infer<typeof Comparison>;
