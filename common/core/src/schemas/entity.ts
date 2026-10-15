import { z } from "zod";

/** A thing that receives reviews: a place (restaurant, shop) or a product. */
export const EntityKind = z.enum(["place", "product"]);
export type EntityKind = z.infer<typeof EntityKind>;

/** Points at an entity on one source platform, e.g. a Google Maps place or an Amazon ASIN. */
export const EntityRef = z.object({
  source: z.string().min(1),
  externalId: z.string().min(1),
});
export type EntityRef = z.infer<typeof EntityRef>;

export const Entity = z.object({
  ref: EntityRef,
  kind: EntityKind,
  name: z.string(),
  url: z.url().optional(),
  category: z.string().optional(),
  address: z.string().optional(),
  brand: z.string().optional(),
  seller: z.string().optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().nonnegative().optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  /** The source's original payload, kept for re-processing. */
  raw: z.unknown().optional(),
});
export type Entity = z.infer<typeof Entity>;
