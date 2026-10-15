import { z } from "zod";
import { defineConnector, type Entity, type EntityRef, type Review } from "@perforvisor/core";
import { hashIdentity } from "@perforvisor/core/node";
import { callSerpApi, SerpReviewsResponse, SerpSearchResponse, type SerpPlace, type SerpReview } from "./serpapi.ts";

const SOURCE = "google_maps";

function toEntity(place: SerpPlace): Entity {
  return {
    ref: { source: SOURCE, externalId: place.place_id },
    kind: "place",
    name: place.title,
    url: `https://www.google.com/maps/place/?q=place_id:${place.place_id}`,
    category: Array.isArray(place.type) ? place.type[0] : place.type,
    address: place.address,
    rating: place.rating,
    reviewCount: place.reviews,
    location: place.gps_coordinates && { lat: place.gps_coordinates.latitude, lng: place.gps_coordinates.longitude },
    raw: place,
  };
}

function toReview(ref: EntityRef, review: SerpReview): Review {
  const authorId = review.user?.contributor_id ?? review.user?.link;
  return {
    source: SOURCE,
    externalId: review.review_id,
    entity: ref,
    rating: review.rating ?? null,
    text: review.extracted_snippet?.original ?? review.snippet ?? "",
    authorHash: authorId ? hashIdentity(SOURCE, authorId) : undefined,
    // An edited review is the customer's current opinion, dated when they last changed it.
    createdAt: new Date(review.iso_date_of_last_edit ?? review.iso_date).toISOString(),
    helpfulCount: review.likes,
    raw: review,
  };
}

export default defineConnector({
  manifest: { id: "serpapi-google-maps", name: "Google Maps (SerpApi)", kind: "connector", source: SOURCE },

  configSchema: z
    .object({ SERPAPI_API_KEY: z.string().min(1, "SERPAPI_API_KEY is required for serpapi-google-maps") })
    .transform((env) => ({ apiKey: env.SERPAPI_API_KEY })),

  create({ apiKey }, ctx) {
    const call = <T>(params: Record<string, string>, schema: z.ZodType<T>) => callSerpApi(ctx.fetch, apiKey, params, schema);

    return {
      async search(query) {
        const res = await call({ engine: "google_maps", type: "search", q: query }, SerpSearchResponse);
        // A query that matches exactly one place returns place_results instead of a list.
        const places = res.local_results ?? (res.place_results ? [res.place_results] : []);
        return places.map(toEntity);
      },

      async getEntity(ref) {
        const res = await call({ engine: "google_maps", place_id: ref.externalId }, SerpSearchResponse);
        if (!res.place_results) throw new Error(`Google Maps place not found: ${ref.externalId}`);
        return toEntity(res.place_results);
      },

      async fetchReviews(ref, options = {}) {
        const params: Record<string, string> = { engine: "google_maps_reviews", place_id: ref.externalId, sort_by: "newestFirst" };
        if (options.cursor) {
          params.next_page_token = options.cursor;
          params.num = "20"; // SerpApi only accepts num on pages after the first.
        }
        const res = await call(params, SerpReviewsResponse);
        const reviews = (res.reviews ?? []).map((r) => toReview(ref, r));

        // Reviews are newest first, so once one is older than `since` the rest are too.
        // Strictly newer: the newest review from the last sync is already stored.
        const fresh = options.since ? reviews.filter((r) => new Date(r.createdAt) > options.since!) : reviews;
        const reachedSince = fresh.length < reviews.length;
        const nextCursor = reachedSince ? undefined : res.serpapi_pagination?.next_page_token;
        ctx.log.debug({ place: ref.externalId, count: fresh.length, more: Boolean(nextCursor) }, "fetched google maps reviews");
        return { reviews: fresh, nextCursor };
      },
    };
  },
});
