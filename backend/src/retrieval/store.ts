import type { AnalysisReviewInput } from "@perforvisor/core";
import type { Config } from "../config.ts";
import type { EntityDoc, Mongo } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import { embedDocuments, embedQuery } from "../ai/embed.ts";

export const reviewKey = (entityKey: string, reviewId: string) =>
  `${entityKey}#${reviewId}`;

export interface IndexResult {
  stored: number;
  embedded: number;
}

/**
 * Upserts an entity and its reviews into MongoDB (full records) and Postgres (retrieval
 * rows), then embeds only reviews that don't have a vector yet.
 */
export async function indexReviews(
  config: Config,
  stores: { mongo: Mongo; pg: Postgres },
  entity: EntityDoc,
  reviews: (AnalysisReviewInput & { raw?: unknown; authorHash?: string })[],
  signal?: AbortSignal,
): Promise<IndexResult> {
  const { mongo, pg } = stores;
  await mongo.entities.updateOne(
    { _id: entity._id },
    { $set: { ...entity, lastSyncedAt: new Date() } },
    { upsert: true },
  );

  // Rating-only reviews (no text) count for statistics but have nothing to search or embed.
  const searchable = reviews.filter((r) => r.text.trim().length > 0);

  if (reviews.length) {
    await mongo.reviews.bulkWrite(
      reviews.map((r) => ({
        updateOne: {
          filter: { _id: reviewKey(entity._id, r.id) },
          update: {
            $set: {
              ...r,
              entityKey: entity._id,
              source: entity.source,
              storedAt: new Date(),
            },
          },
          upsert: true,
        },
      })),
    );
  }
  if (searchable.length) {
    // Search rows; text changes clear the embedding so it gets recomputed.
    await pg.query(
      `INSERT INTO review_search (review_key, entity_key, rating, created_at, text)
       SELECT * FROM unnest($1::text[], $2::text[], $3::real[], $4::timestamptz[], $5::text[])
       ON CONFLICT (review_key) DO UPDATE SET
         rating = EXCLUDED.rating, created_at = EXCLUDED.created_at, text = EXCLUDED.text,
         embedding = CASE WHEN review_search.text = EXCLUDED.text THEN review_search.embedding END`,
      [
        searchable.map((r) => reviewKey(entity._id, r.id)),
        searchable.map(() => entity._id),
        searchable.map((r) => r.rating ?? null),
        searchable.map((r) => r.createdAt ?? null),
        searchable.map((r) => r.text),
      ],
    );
  }

  const { rows: pending } = await pg.query<{
    review_key: string;
    text: string;
  }>(
    `SELECT review_key, text FROM review_search WHERE entity_key = $1 AND embedding IS NULL`,
    [entity._id],
  );
  if (pending.length) {
    const vectors = await embedDocuments(
      config,
      entity.name,
      pending.map((p) => p.text),
      signal,
    );
    await pg.query(
      `UPDATE review_search AS r SET embedding = v.embedding::vector
       FROM unnest($1::text[], $2::text[]) AS v(review_key, embedding)
       WHERE r.review_key = v.review_key`,
      [pending.map((p) => p.review_key), vectors.map((v) => JSON.stringify(v))],
    );
  }
  return { stored: reviews.length, embedded: pending.length };
}

export interface Match {
  id: string;
  text: string;
  rating?: number;
  createdAt?: string;
  /** Cosine similarity to the question, from -1 to 1. */
  similarity: number;
}

/** The reviews of one entity most similar to the question, by cosine similarity. */
export async function vectorSearch(
  config: Config,
  pg: Postgres,
  entityKey: string,
  question: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Match[]> {
  const queryVector = await embedQuery(config, question, signal);
  const { rows } = await pg.query<{
    review_key: string;
    text: string;
    rating: number | null;
    created_at: Date | null;
    similarity: number;
  }>(
    `SELECT review_key, text, rating, created_at, 1 - (embedding <=> $2::vector) AS similarity
     FROM review_search
     WHERE entity_key = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector
     LIMIT $3`,
    [entityKey, JSON.stringify(queryVector), limit],
  );
  return rows.map((row) => ({
    id: row.review_key.slice(row.review_key.indexOf("#") + 1),
    text: row.text,
    rating: row.rating ?? undefined,
    createdAt: row.created_at?.toISOString(),
    similarity: Number(row.similarity),
  }));
}

export async function countReviews(
  pg: Postgres,
  entityKey: string,
): Promise<number> {
  const { rows } = await pg.query<{ n: string }>(
    `SELECT count(*) AS n FROM review_search WHERE entity_key = $1`,
    [entityKey],
  );
  return Number(rows[0]?.n ?? 0);
}
