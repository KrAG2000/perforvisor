import type { Burst, TrendPoint, Trends } from "@perforvisor/core";
import type { Postgres } from "../db/postgres.ts";

/**
 * Rating and sentiment over time from the review_events hypertable, plus review bursts:
 * days with at least BURST_MIN reviews and BURST_FACTOR times the business's average daily
 * volume over the synced range. A burst is labelled five_star / one_star when at least 80%
 * of that day's reviews have that rating.
 */
const BURST_MIN = 3;
const BURST_FACTOR = 3;

export async function readTrends(
  pg: Postgres,
  entityKey: string,
): Promise<Trends> {
  const { rows: rangeRows } = await pg.query<{
    from: Date | null;
    to: Date | null;
    n: string;
  }>(
    `SELECT min(ts) AS "from", max(ts) AS "to", count(*) AS n FROM review_events WHERE entity_key = $1`,
    [entityKey],
  );
  const range = rangeRows[0];
  if (!range?.from || !range.to)
    return { bucket: "week", points: [], bursts: [], range: null };

  const days = Math.max(
    1,
    (range.to.getTime() - range.from.getTime()) / 86_400_000,
  );
  const bucket = days <= 21 ? "day" : days <= 180 ? "week" : "month";

  const { rows } = await pg.query<{
    bucket: Date;
    reviews: string;
    avg_rating: number | null;
    positive: string;
    neutral: string;
    negative: string;
  }>(
    `SELECT time_bucket($2::interval, ts) AS bucket, count(*) AS reviews, avg(rating) AS avg_rating,
            count(*) FILTER (WHERE sentiment = 1) AS positive,
            count(*) FILTER (WHERE sentiment = 0) AS neutral,
            count(*) FILTER (WHERE sentiment = -1) AS negative
     FROM review_events WHERE entity_key = $1
     GROUP BY 1 ORDER BY 1`,
    [entityKey, `1 ${bucket}`],
  );
  const points: TrendPoint[] = rows.map((r) => ({
    bucket: r.bucket.toISOString(),
    reviews: Number(r.reviews),
    averageRating:
      r.avg_rating === null ? null : Number(Number(r.avg_rating).toFixed(2)),
    positive: Number(r.positive),
    neutral: Number(r.neutral),
    negative: Number(r.negative),
  }));

  const typical = Number(range.n) / days;
  const { rows: dayRows } = await pg.query<{
    day: Date;
    reviews: string;
    avg_rating: number | null;
    five: string;
    one: string;
  }>(
    `SELECT time_bucket('1 day', ts) AS day, count(*) AS reviews, avg(rating) AS avg_rating,
            count(*) FILTER (WHERE rating >= 5) AS five, count(*) FILTER (WHERE rating <= 1) AS one
     FROM review_events WHERE entity_key = $1
     GROUP BY 1 HAVING count(*) >= $2 AND count(*) >= $3::numeric ORDER BY 1`,
    [entityKey, BURST_MIN, BURST_FACTOR * typical],
  );
  const bursts: Burst[] = dayRows.map((r) => {
    const reviews = Number(r.reviews);
    return {
      day: r.day.toISOString(),
      reviews,
      typical: Number(typical.toFixed(2)),
      averageRating:
        r.avg_rating === null ? null : Number(Number(r.avg_rating).toFixed(2)),
      kind:
        Number(r.five) / reviews >= 0.8
          ? "five_star"
          : Number(r.one) / reviews >= 0.8
            ? "one_star"
            : "volume",
    };
  });

  return {
    bucket,
    points,
    bursts,
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
  };
}
