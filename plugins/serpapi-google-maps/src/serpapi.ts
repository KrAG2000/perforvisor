import { z } from "zod";

// Only the fields we use are declared; SerpApi responses carry many more,
// which loose objects keep (they end up in each record's `raw`).

export const SerpPlace = z.looseObject({
  place_id: z.string(),
  data_id: z.string().optional(),
  title: z.string(),
  address: z.string().optional(),
  // A string in search lists, a list of categories in single-place results.
  type: z.union([z.string(), z.array(z.string())]).optional(),
  rating: z.number().optional(),
  reviews: z.number().optional(),
  website: z.string().optional(),
  gps_coordinates: z.object({ latitude: z.number(), longitude: z.number() }).optional(),
});
export type SerpPlace = z.infer<typeof SerpPlace>;

export const SerpSearchResponse = z.looseObject({
  local_results: z.array(SerpPlace).optional(),
  place_results: SerpPlace.optional(),
});

export const SerpReview = z.looseObject({
  review_id: z.string(),
  rating: z.number().optional(),
  snippet: z.string().optional(),
  extracted_snippet: z.object({ original: z.string().optional() }).optional(),
  iso_date: z.string(),
  // Present when the reviewer edited the review; Google's "newest" order uses it.
  iso_date_of_last_edit: z.string().optional(),
  likes: z.number().optional(),
  user: z.looseObject({ name: z.string().optional(), contributor_id: z.string().optional(), link: z.string().optional() }).optional(),
});
export type SerpReview = z.infer<typeof SerpReview>;

export const SerpReviewsResponse = z.looseObject({
  reviews: z.array(SerpReview).optional(),
  serpapi_pagination: z.object({ next_page_token: z.string().optional() }).optional(),
});

export const SerpError = z.object({ error: z.string() });

export async function callSerpApi<T>(
  fetchImpl: typeof fetch,
  apiKey: string,
  params: Record<string, string>,
  schema: z.ZodType<T>,
): Promise<T> {
  const url = new URL("https://serpapi.com/search.json");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("api_key", apiKey);

  const res = await fetchImpl(url);
  const body: unknown = await res.json();
  const apiError = SerpError.safeParse(body);
  if (!res.ok || apiError.success) {
    throw new Error(`SerpApi ${params.engine} failed (${res.status}): ${apiError.success ? apiError.data.error : res.statusText}`);
  }
  return schema.parse(body);
}
