import { ReviewExtraction, type AnalysisReviewInput } from "@perforvisor/core";
import type { Config } from "../config.ts";
import { createChatModel } from "./model.ts";

const EXTRACT_PROMPT = `You analyse one customer review. Extract:
- sentiment: the overall sentiment of the text (ignore the star rating).
- aspects: each aspect the reviewer talks about, listed once, with its own sentiment. Aspect meanings:
  food/taste = the dishes themselves; quality = how well a product is made; value = price for what you get;
  service/staff = how customers were treated; wait_time = waiting at the venue for a table, order or food;
  delivery = orders delivered to the customer's home; packaging = containers and wrapping;
  cleanliness = tables, floors, restrooms; ambience = music, decor, atmosphere;
  durability/performance = how a product holds up and works; authenticity = genuine vs fake product.
  Use "other" only if nothing fits.
- claims: short, specific statements from the review, max 12 words each, each tagged with the aspect it is about. Skip vague praise like "amazing place".
Respond with JSON only.`;

/** Per-review extraction with the extraction model; null when the model fails or returns junk. */
export function createExtractor(config: Config) {
  const model = createChatModel(config, { role: "extract", temperature: 0 }).withStructuredOutput(ReviewExtraction, {
    name: "review_extraction",
    method: "jsonSchema",
  });
  return async (review: AnalysisReviewInput, signal?: AbortSignal): Promise<ReviewExtraction | null> => {
    try {
      return await model.invoke(
        [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: `Rating: ${review.rating ?? "unknown"}/5\nReview: ${review.text}` },
        ],
        { signal },
      );
    } catch {
      // A malformed or failed extraction is skipped, never fatal (AI-5).
      return null;
    }
  };
}

export type Extractor = ReturnType<typeof createExtractor>;
