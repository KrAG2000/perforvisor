import { mapWithConcurrency, type AnalysisReviewInput, type SyncStatus } from "@perforvisor/core";
import type { Config } from "../config.ts";
import type { AnalysisDoc, EntityDoc, Mongo } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import type { Connectors } from "../plugins/loader.ts";
import { indexReviews } from "../retrieval/store.ts";
import { computeStats, isRatingMismatch } from "../ai/stats.ts";
import type { Extractor } from "../ai/extract.ts";
import type { Advisor } from "../ai/advise.ts";
import type { GraphBuilder } from "./graph.ts";
import { IMPORT_SOURCE } from "./keys.ts";

export interface SyncDeps {
  config: Config;
  stores: { mongo: Mongo; pg: Postgres };
  connectors: Connectors;
  extract: Extractor;
  advise: Advisor;
  graph: GraphBuilder;
}

export interface SyncResult {
  fetched: number;
  analysed: number;
  claimsAdded: number;
  claimsMerged: number;
}

const sentimentValue = { positive: 1, neutral: 0, negative: -1 } as const;

async function setStatus(mongo: Mongo, entityKey: string, status: Partial<SyncStatus>) {
  const set = Object.fromEntries(Object.entries(status).map(([k, v]) => [`sync.${k}`, v]));
  await mongo.entities.updateOne({ _id: entityKey }, { $set: set });
}

/**
 * One sync of a tracked business: fetch new reviews → store and embed → extract with the
 * chat model → update the knowledge graph and trend rows → rebuild the report.
 * Progress is written to the entity's `sync` field, which the API streams to the app.
 */
export async function syncBusiness(deps: SyncDeps, entityKey: string, signal?: AbortSignal): Promise<SyncResult> {
  const { config, stores, connectors } = deps;
  const { mongo, pg } = stores;
  const entity = await mongo.entities.findOne({ _id: entityKey });
  if (!entity) throw new Error(`Business ${entityKey} is not tracked`);

  const progress = (stage: string, message: string, percent: number) => setStatus(mongo, entityKey, { state: "running", stage, message, percent });
  await setStatus(mongo, entityKey, { state: "running", stage: "fetch", message: "Starting", percent: 2, startedAt: new Date().toISOString(), error: undefined });

  try {
    // 1. Fetch new reviews (imports were stored when they were added).
    const fetched: (AnalysisReviewInput & { raw?: unknown; authorHash?: string })[] = [];
    if (entity.source !== IMPORT_SOURCE) {
      const loaded = connectors.get(entity.source);
      if (!loaded) throw new Error(`The ${entity.source} connector isn't enabled on this server.`);
      const since = entity.sync?.lastReviewAt ? new Date(entity.sync.lastReviewAt) : undefined;
      const pages = since ? config.SYNC_RESYNC_PAGES : config.SYNC_INITIAL_PAGES;
      let cursor: string | undefined;
      for (let page = 1; page <= pages; page++) {
        await progress("fetch", `Fetching reviews (page ${page} of up to ${pages})`, 5 + Math.round((page / pages) * 15));
        const result = await loaded.connector.fetchReviews({ source: entity.source, externalId: entity.externalId }, { cursor, since });
        fetched.push(
          ...result.reviews.map((r) => ({ id: r.externalId, text: r.text, rating: r.rating ?? undefined, createdAt: r.createdAt, authorHash: r.authorHash, raw: r.raw })),
        );
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
    }

    // 2. Store (MongoDB), index and embed (Postgres), and record trend events (TimescaleDB).
    await progress("index", `Indexing ${fetched.length} new reviews`, 22);
    const base: EntityDoc = { _id: entity._id, source: entity.source, externalId: entity.externalId, kind: entity.kind, name: entity.name };
    await indexReviews(config, stores, base, fetched, signal);

    const all = await mongo.reviews.find({ entityKey }).toArray();
    if (all.length) {
      await pg.query(
        `INSERT INTO review_events (entity_key, review_key, ts, rating)
         SELECT $1, * FROM unnest($2::text[], $3::timestamptz[], $4::real[])
         ON CONFLICT DO NOTHING`,
        [entityKey, all.map((r) => r._id), all.map((r) => r.createdAt ?? r.storedAt.toISOString()), all.map((r) => r.rating ?? null)],
      );
    }

    // 3. Extract every review with text that hasn't been analysed yet.
    const analysedIds = new Set((await mongo.analyses.find({ entityKey }, { projection: { _id: 1 } }).toArray()).map((a) => a._id));
    const pending = all.filter((r) => r.text.trim() && !analysedIds.has(r._id));
    let done = 0;
    const fresh = (
      await mapWithConcurrency(pending, config.LLM_CONCURRENCY, async (review) => {
        const extraction = await deps.extract(review, signal);
        done++;
        if (done % 2 === 0 || done === pending.length) await progress("extract", `Analysed ${done} of ${pending.length} reviews`, 25 + Math.round((done / pending.length) * 50));
        if (!extraction) return null;
        const doc: AnalysisDoc = {
          ...extraction,
          _id: review._id,
          entityKey,
          reviewId: review.id,
          ratingMismatch: isRatingMismatch(review.rating, extraction.sentiment),
          model: config.EXTRACT_MODEL ?? config.CHAT_MODEL,
          analysedAt: new Date(),
        };
        await mongo.analyses.replaceOne({ _id: doc._id }, doc, { upsert: true });
        await pg.query(`UPDATE review_events SET sentiment = $3 WHERE entity_key = $1 AND review_key = $2`, [entityKey, review._id, sentimentValue[extraction.sentiment]]);
        return doc;
      })
    ).filter((a): a is AnalysisDoc => a !== null);

    // 4. Knowledge graph: merge the new claims.
    await progress("graph", `Updating the knowledge graph with ${fresh.length} reviews`, 78);
    const dates = new Map(all.map((r) => [r.id, r.createdAt ? new Date(r.createdAt) : undefined]));
    const { added, merged } = await deps.graph.addAnalyses(entityKey, entity.name, fresh, dates, signal);
    if (entity.tracking?.role === "competitor" && entity.tracking.competitorOf) await deps.graph.linkCompetitor(entity.tracking.competitorOf, entityKey);

    // 5. Report over everything stored so far.
    await progress("report", "Writing the report", 90);
    // Mismatch flags are recomputed so rule changes apply to reviews analysed earlier.
    const ratings = new Map(all.map((r) => [r.id, r.rating]));
    const analyses = (await mongo.analyses.find({ entityKey }).toArray()).map((a) => ({ ...a, ratingMismatch: isRatingMismatch(ratings.get(a.reviewId), a.sentiment) }));
    const inputs = all.filter((r) => r.text.trim()).map((r) => ({ id: r.id, text: r.text, rating: r.rating, createdAt: r.createdAt }));
    const stats = computeStats(inputs, analyses);
    const summary = await deps.advise(entity.name, stats, signal);
    await mongo.reports.replaceOne({ _id: entityKey }, { stats, summary, generatedAt: new Date() }, { upsert: true });

    const newest = all.map((r) => r.createdAt).filter((d): d is string => !!d).sort().at(-1);
    await mongo.entities.updateOne(
      { _id: entityKey },
      {
        $set: {
          "sync.state": "done",
          "sync.stage": "done",
          "sync.message":
            entity.source === IMPORT_SOURCE
              ? `Imported reviews analysed: ${fresh.length}`
              : fetched.length
                ? `Synced: ${fetched.length} new, ${fresh.length} analysed`
                : "Up to date: no new reviews",
          "sync.percent": 100,
          "sync.finishedAt": new Date().toISOString(),
          ...(newest ? { "sync.lastReviewAt": newest } : {}),
        },
        $unset: { "sync.error": "" },
      },
    );
    return { fetched: fetched.length, analysed: fresh.length, claimsAdded: added, claimsMerged: merged };
  } catch (error) {
    await setStatus(mongo, entityKey, { state: "error", error: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
    throw error;
  }
}


