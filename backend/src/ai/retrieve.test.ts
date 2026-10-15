import { describe, expect, it } from "vitest";
import { rankReviews } from "./retrieve.ts";

const reviews = [
  { id: "a", text: "Great capacity and fast charging." },
  { id: "b", text: "It overheated badly on a flight." },
  { id: "c", text: "Gets really hot and overheats while charging my laptop." },
];

describe("rankReviews", () => {
  it("ranks reviews matching the question's terms first, including word variants", () => {
    const ranked = rankReviews("Do people say this power bank overheats?", reviews);
    expect(ranked.map((r) => r.review.id)).toEqual(["b", "c", "a"]);
    expect(ranked[0]!.score).toBeGreaterThan(0);
    expect(ranked[2]!.score).toBe(0);
  });

  it("respects the limit", () => {
    expect(rankReviews("charging", reviews, 1)).toHaveLength(1);
  });
});
