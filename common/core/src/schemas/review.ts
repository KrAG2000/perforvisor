import { z } from "zod";
import { EntityRef } from "./entity.ts";

/** The standard review record. Every connector converts its source's reviews into this shape. */
export const Review = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
  entity: EntityRef,
  rating: z.number().min(0).max(5).nullable(),
  title: z.string().optional(),
  text: z.string(),
  /** Hash of the reviewer's id on the source; the raw identity is never stored. */
  authorHash: z.string().optional(),
  createdAt: z.iso.datetime(),
  verified: z.boolean().optional(),
  helpfulCount: z.number().int().nonnegative().optional(),
  language: z.string().optional(),
  raw: z.unknown().optional(),
});
export type Review = z.infer<typeof Review>;

export const ReviewPage = z.object({
  reviews: z.array(Review),
  /** Opaque cursor for the next page; absent when there are no more pages. */
  nextCursor: z.string().optional(),
});
export type ReviewPage = z.infer<typeof ReviewPage>;
