import type {
  AnalysisReviewInput,
  AnalysisStats,
  Aspect,
  AspectStat,
  ClaimCount,
  ReviewAnalysis,
  ReviewExtraction,
  Sentiment,
} from "@perforvisor/core";

/**
 * True when the star rating and the text's sentiment clearly contradict each other (TRU-3).
 * Only the extremes count: on real reviews, 4★ with a mild complaint ("gravy could be
 * better") is normal, while 5★ on "terrible experience" is not.
 */
export function isRatingMismatch(
  rating: number | undefined,
  sentiment: Sentiment,
): boolean {
  if (rating === undefined) return false;
  return (
    (rating >= 5 && sentiment === "negative") ||
    (rating <= 1 && sentiment === "positive")
  );
}

export function toReviewAnalysis(
  review: AnalysisReviewInput,
  extraction: ReviewExtraction,
): ReviewAnalysis {
  return {
    ...extraction,
    reviewId: review.id,
    ratingMismatch: isRatingMismatch(review.rating, extraction.sentiment),
  };
}

const normalizeClaim = (claim: string) =>
  claim
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

function shingles(text: string, size = 3): Set<string> {
  const words = normalizeClaim(text).split(" ").filter(Boolean);
  const set = new Set<string>();
  if (words.length < size) {
    if (words.length) set.add(words.join(" "));
    return set;
  }
  for (let i = 0; i <= words.length - size; i++)
    set.add(words.slice(i, i + size).join(" "));
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared++;
  return shared / (a.size + b.size - shared);
}

/**
 * Reviews shorter than this aren't compared: many genuine customers write just "Good" or
 * "Nice place", so short texts match each other without being copies.
 */
const MIN_DUPLICATE_WORDS = 5;

/** Groups reviews whose text is near-identical (TRU-2). Quadratic; fine for one entity's reviews. */
export function findDuplicateGroups(
  allReviews: AnalysisReviewInput[],
  threshold = 0.7,
): string[][] {
  const reviews = allReviews.filter(
    (r) =>
      normalizeClaim(r.text).split(" ").filter(Boolean).length >=
      MIN_DUPLICATE_WORDS,
  );
  const sets = reviews.map((r) => shingles(r.text));
  const parent = reviews.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]!));

  for (let i = 0; i < reviews.length; i++) {
    for (let j = i + 1; j < reviews.length; j++) {
      if (jaccard(sets[i]!, sets[j]!) >= threshold) parent[find(j)] = find(i);
    }
  }

  const groups = new Map<number, string[]>();
  reviews.forEach((review, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), review.id]);
  });
  return [...groups.values()].filter((group) => group.length > 1);
}

/**
 * A claim takes the sentiment the review gave its aspect ("taste was fine" in an otherwise
 * negative review is not a complaint); the review's overall sentiment is the fallback.
 */
export function claimSentiment(
  analysis: Pick<ReviewAnalysis, "aspects" | "sentiment">,
  aspect: Aspect,
): Sentiment {
  return (
    analysis.aspects.find((a) => a.aspect === aspect)?.sentiment ??
    analysis.sentiment
  );
}

function countClaims(
  analyses: ReviewAnalysis[],
  limit: number,
  sentiment?: Sentiment,
): ClaimCount[] {
  const claims = new Map<string, ClaimCount>();
  for (const analysis of analyses) {
    for (const { text: claim, aspect } of analysis.claims) {
      if (sentiment && claimSentiment(analysis, aspect) !== sentiment) continue;
      const key = normalizeClaim(claim);
      if (!key) continue;
      const entry = claims.get(key) ?? { claim, count: 0 };
      entry.count++;
      claims.set(key, entry);
    }
  }
  return [...claims.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function computeStats(
  reviews: AnalysisReviewInput[],
  analyses: ReviewAnalysis[],
): AnalysisStats {
  const ratings = reviews
    .map((r) => r.rating)
    .filter((r): r is number => r !== undefined);
  const sentiment = { positive: 0, neutral: 0, negative: 0 };
  const aspects = new Map<Aspect, AspectStat>();

  const duplicateGroups = findDuplicateGroups(reviews);
  const ratingMismatches = analyses
    .filter((a) => a.ratingMismatch)
    .map((a) => a.reviewId);
  // Every review in a duplicate group is suspicious: with copy-pasted text there's no
  // telling which one, if any, is genuine.
  const suspicious = new Set([...ratingMismatches, ...duplicateGroups.flat()]);
  const trusted = analyses.filter((a) => !suspicious.has(a.reviewId));

  for (const analysis of analyses) {
    sentiment[analysis.sentiment]++;

    // Count each aspect once per review, even if the model listed it twice.
    const seen = new Set<Aspect>();
    for (const { aspect, sentiment: s } of analysis.aspects) {
      if (seen.has(aspect)) continue;
      seen.add(aspect);
      const stat = aspects.get(aspect) ?? {
        aspect,
        mentions: 0,
        positive: 0,
        neutral: 0,
        negative: 0,
        score: 0,
      };
      stat.mentions++;
      stat[s]++;
      aspects.set(aspect, stat);
    }
  }

  for (const stat of aspects.values())
    stat.score = Number(
      ((stat.positive - stat.negative) / stat.mentions).toFixed(2),
    );

  return {
    reviewCount: reviews.length,
    analysedCount: analyses.length,
    failedCount: reviews.length - analyses.length,
    averageRating: ratings.length
      ? Number((ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(2))
      : null,
    sentiment,
    aspects: [...aspects.values()].sort((a, b) => b.mentions - a.mentions),
    topClaims: countClaims(analyses, 10),
    praise: countClaims(trusted, 5, "positive"),
    complaints: countClaims(trusted, 5, "negative"),
    suspiciousReviewIds: [...suspicious],
    ratingMismatches,
    duplicateGroups,
  };
}
