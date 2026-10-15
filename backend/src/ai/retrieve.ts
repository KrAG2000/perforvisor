import type { AnalysisReviewInput } from "@perforvisor/core";

const STOPWORDS = new Set(
  "a an and are as at be but by do does did for from has have how i if in is it its of on or people say says so that the their them they this to was were what when where which who why will with you your about any there".split(" "),
);

const terms = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));

// Crude stemming: "overheats", "overheated" and "overheating" share "overhea".
const stem = (word: string) => word.slice(0, Math.max(4, Math.min(7, word.length - 1)));

/**
 * Ranks reviews by keyword overlap with the question. A stand-in until the
 * knowledge graph's vector search (KG-4) exists.
 */
export function rankReviews(question: string, reviews: AnalysisReviewInput[], limit = 12): { review: AnalysisReviewInput; score: number }[] {
  const queryStems = [...new Set(terms(question).map(stem))];
  return reviews
    .map((review, index) => {
      const words = terms(review.text);
      const score = queryStems.filter((q) => words.some((w) => w.startsWith(q))).length;
      return { review, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ review, score }) => ({ review, score }));
}
