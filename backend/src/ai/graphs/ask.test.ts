import { describe, expect, it } from "vitest";
import { stripReviewIds } from "./ask.ts";

describe("stripReviewIds", () => {
  const ids = ["r2", "r4", "r10", "p2", "p9", "p10"];

  it("removes parenthesised id lists", () => {
    expect(
      stripReviewIds("Three reviews (r4, r10, r2) highlight this issue.", ids),
    ).toBe("Three reviews highlight this issue.");
  });

  it("removes bracketed ids listed after a colon", () => {
    expect(
      stripReviewIds(
        "Yes, it overheats. 3 reviews mention overheating issues: [p2], [p10], and [p9].",
        ids,
      ),
    ).toBe("Yes, it overheats. 3 reviews mention overheating issues.");
  });

  it("leaves text without ids untouched, including numbers and words that contain an id", () => {
    expect(
      stripReviewIds(
        "Rated 4 out of 5; p2p transfers and r2d2 jokes aside, 10 reviews agree.",
        ids,
      ),
    ).toBe(
      "Rated 4 out of 5; p2p transfers and r2d2 jokes aside, 10 reviews agree.",
    );
  });
});
