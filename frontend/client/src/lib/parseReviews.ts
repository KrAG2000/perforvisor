import type { AnalysisReviewInput } from "@perforvisor/core";

/**
 * One review per line. An optional leading rating is read from "4 | text",
 * "4: text" or "4 - text".
 */
export function parseReviews(input: string): AnalysisReviewInput[] {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, i) => {
      const match = /^([0-5](?:\.\d)?)\s*[|:-]\s*(.+)$/.exec(line);
      return match
        ? { id: `u${i + 1}`, rating: Number(match[1]), text: match[2]! }
        : { id: `u${i + 1}`, text: line };
    });
}
