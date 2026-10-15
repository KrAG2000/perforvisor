import { z } from "zod";
import { EntityKind } from "./entity.ts";
import { AnalysisReviewInput } from "./analysis.ts";

/** A built-in set of reviews for one place or product, used until live connectors are enabled. */
export const SampleDataset = z.object({
  id: z.string(),
  kind: EntityKind,
  entityName: z.string(),
  category: z.string(),
  reviews: z.array(AnalysisReviewInput).min(1),
});
export type SampleDataset = z.infer<typeof SampleDataset>;

export const SampleSummary = SampleDataset.omit({ reviews: true }).extend({ reviewCount: z.number().int() });
export type SampleSummary = z.infer<typeof SampleSummary>;
