import { describe, expect, it } from "vitest";
import type { AnalysisReviewInput, ReviewAnalysis } from "@perforvisor/core";
import { computeStats, findDuplicateGroups, isRatingMismatch } from "./stats.ts";

const review = (id: string, text: string, rating?: number): AnalysisReviewInput => ({ id, text, rating });

describe("isRatingMismatch", () => {
  it("flags 5-star reviews with negative text and 1-star reviews with positive text", () => {
    expect(isRatingMismatch(5, "negative")).toBe(true);
    expect(isRatingMismatch(1, "positive")).toBe(true);
  });

  it("accepts consistent, mildly mixed, or unrated reviews", () => {
    expect(isRatingMismatch(5, "positive")).toBe(false);
    expect(isRatingMismatch(4, "negative")).toBe(false);
    expect(isRatingMismatch(2, "positive")).toBe(false);
    expect(isRatingMismatch(undefined, "negative")).toBe(false);
  });
});

describe("computeStats suspicious reviews", () => {
  it("treats every review in a duplicate group as suspicious and keeps them out of praise", () => {
    const text = "Amazing place, best restaurant in the city, everyone must visit";
    const reviews = [review("a", text, 5), review("b", text + "!", 5), review("c", "The biryani is excellent", 5)];
    const analysis = (id: string, claim: string): ReviewAnalysis => ({
      reviewId: id,
      sentiment: "positive",
      ratingMismatch: false,
      aspects: [{ aspect: "food", sentiment: "positive" }],
      claims: [{ text: claim, aspect: "food" }],
    });

    const stats = computeStats(reviews, [analysis("a", "Best restaurant in the city"), analysis("b", "Best restaurant in the city"), analysis("c", "Biryani is excellent")]);

    expect(stats.suspiciousReviewIds.sort()).toEqual(["a", "b"]);
    expect(stats.praise).toEqual([{ claim: "Biryani is excellent", count: 1 }]);
    expect(stats.topClaims[0]).toEqual({ claim: "Best restaurant in the city", count: 2 });
  });

  it("classifies a claim by its aspect's sentiment, not the whole review's", () => {
    const stats = computeStats(
      [review("x", "Container cracked and the dal spilled. Taste was fine.", 2)],
      [
        {
          reviewId: "x",
          sentiment: "negative",
          ratingMismatch: false,
          aspects: [
            { aspect: "packaging", sentiment: "negative" },
            { aspect: "taste", sentiment: "positive" },
          ],
          claims: [
            { text: "Container cracked", aspect: "packaging" },
            { text: "Taste was fine", aspect: "taste" },
          ],
        },
      ],
    );
    expect(stats.complaints).toEqual([{ claim: "Container cracked", count: 1 }]);
    expect(stats.praise).toEqual([{ claim: "Taste was fine", count: 1 }]);
  });
});

describe("findDuplicateGroups", () => {
  it("groups near-identical reviews and ignores distinct ones", () => {
    const groups = findDuplicateGroups([
      review("a", "Amazing place!!! Best restaurant in the city, everyone must visit, five stars"),
      review("b", "Amazing place! Best restaurant in the city, everyone must visit, five stars!"),
      review("c", "Waited fifty minutes and the biryani arrived cold."),
    ]);
    expect(groups).toEqual([["a", "b"]]);
  });

  it("ignores very short reviews, which genuine customers often write identically", () => {
    expect(findDuplicateGroups([review("a", "Good"), review("b", "Good 👍"), review("c", "Nice place")])).toEqual([]);
  });
});

describe("computeStats", () => {
  it("aggregates sentiment, aspects and claims", () => {
    const reviews = [review("1", "Great food, slow service", 4), review("2", "Food was cold", 5)];
    const analyses: ReviewAnalysis[] = [
      {
        reviewId: "1",
        sentiment: "positive",
        ratingMismatch: false,
        aspects: [
          { aspect: "food", sentiment: "positive" },
          { aspect: "service", sentiment: "negative" },
        ],
        claims: [{ text: "Service is slow", aspect: "service" }],
      },
      {
        reviewId: "2",
        sentiment: "negative",
        ratingMismatch: true,
        aspects: [
          { aspect: "food", sentiment: "negative" },
          { aspect: "food", sentiment: "negative" },
        ],
        claims: [{ text: "service is slow!", aspect: "service" }],
      },
    ];

    const stats = computeStats(reviews, analyses);

    expect(stats.averageRating).toBe(4.5);
    expect(stats.sentiment).toEqual({ positive: 1, neutral: 0, negative: 1 });
    expect(stats.aspects[0]).toEqual({ aspect: "food", mentions: 2, positive: 1, neutral: 0, negative: 1, score: 0 });
    expect(stats.topClaims).toEqual([{ claim: "Service is slow", count: 2 }]);
    expect(stats.ratingMismatches).toEqual(["2"]);
    // Review 2 is suspicious (rating mismatch). Review 1's claim is about service, which it
    // rated negative, so it's a complaint even though the review is positive overall.
    expect(stats.praise).toEqual([]);
    expect(stats.complaints).toEqual([{ claim: "Service is slow", count: 1 }]);
    expect(stats.suspiciousReviewIds).toEqual(["2"]);
    expect(stats.failedCount).toBe(0);
  });
});
