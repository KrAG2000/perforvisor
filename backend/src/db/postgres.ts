import pg from "pg";
import type { Config } from "../config.ts";

/**
 * Retrieval index (Tiger Data / Postgres + pgvector). MongoDB holds the full records; this
 * table holds what retrieval needs. Idempotent, so it runs at every startup.
 */
const migrations = (dimensions: number) => [
  `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE IF NOT EXISTS review_search (
     review_key  text PRIMARY KEY,
     entity_key  text NOT NULL,
     rating      real,
     created_at  timestamptz,
     text        text NOT NULL,
     embedding   vector(${dimensions})
   )`,
  // Retrieval is always scoped to one entity, so a btree on entity_key plus an exact
  // vector scan is fast and avoids HNSW's filtered-search recall problems at this scale.
  `CREATE INDEX IF NOT EXISTS review_search_entity ON review_search (entity_key)`,
  // Full-text search was dropped from retrieval (2026-10-15): cosine similarity alone ranked better.
  `DROP INDEX IF EXISTS review_search_tsv`,
  `ALTER TABLE review_search DROP COLUMN IF EXISTS tsv`,

  // Trends (TimescaleDB): one row per review at its posting time.
  `CREATE EXTENSION IF NOT EXISTS timescaledb`,
  `CREATE TABLE IF NOT EXISTS review_events (
     entity_key  text NOT NULL,
     review_key  text NOT NULL,
     ts          timestamptz NOT NULL,
     rating      real,
     sentiment   smallint, -- 1 positive, 0 neutral, -1 negative; null until analysed
     PRIMARY KEY (entity_key, review_key, ts)
   )`,
  `SELECT create_hypertable('review_events', by_range('ts', INTERVAL '30 days'), if_not_exists => TRUE)`,

  // Claim vectors for merging similar claims into one knowledge-graph node.
  `CREATE TABLE IF NOT EXISTS claim_vectors (
     node_id     text PRIMARY KEY,
     entity_key  text NOT NULL,
     sentiment   text NOT NULL,
     text        text NOT NULL,
     embedding   vector(${dimensions}) NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS claim_vectors_entity ON claim_vectors (entity_key, sentiment)`,
];

export async function connectPostgres(config: Config) {
  const schema = config.PG_SCHEMA;
  // A dedicated schema keeps Perforvisor's tables apart from anything else in a shared
  // database; extensions and TimescaleDB functions are still found through public.
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.PG_POOL_MAX,
    connectionTimeoutMillis: 10_000,
    options: `-c search_path=${schema},public`,
  });
  // Only create the schema when it's missing: CREATE SCHEMA IF NOT EXISTS still needs the
  // database-level CREATE privilege, which a least-privilege app role doesn't have.
  const { rowCount } = await pool.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
  if (!rowCount) await pool.query(`CREATE SCHEMA ${schema}`);
  for (const sql of migrations(config.EMBED_DIMENSIONS)) await pool.query(sql);
  return pool;
}

export type Postgres = pg.Pool;
