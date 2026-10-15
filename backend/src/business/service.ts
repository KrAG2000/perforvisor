import type { BusinessDetail, BusinessReport, BusinessSummary, Comparison, ImportRequest, ReviewItem, TrackRequest } from "@perforvisor/core";
import { ImportRequest as ImportRequestSchema, TrackRequest as TrackRequestSchema } from "@perforvisor/core";
import { createHash } from "node:crypto";
import type { EntityDoc, Mongo, ReportDoc } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import type { SyncQueue } from "../lib/queue.ts";
import type { GraphBuilder } from "./graph.ts";
import { entityKeyOf, IMPORT_SOURCE } from "./keys.ts";
import { reviewKey } from "../retrieval/store.ts";

export class NotFoundError extends Error {}

export function createBusinessService(deps: { mongo: Mongo; pg: Postgres; queue: SyncQueue; graph: GraphBuilder }) {
  const { mongo, pg, queue, graph } = deps;

  function toReport(doc: ReportDoc | null, key: string): BusinessReport | null {
    return doc ? { key, stats: doc.stats, summary: doc.summary, generatedAt: doc.generatedAt.toISOString() } : null;
  }

  async function summarize(entity: EntityDoc & { tracking: NonNullable<EntityDoc["tracking"]> }, report: ReportDoc | null): Promise<BusinessSummary> {
    const [storedReviews, analysedReviews] = await Promise.all([mongo.reviews.countDocuments({ entityKey: entity._id }), mongo.analyses.countDocuments({ entityKey: entity._id })]);
    return {
      key: entity._id,
      source: entity.source,
      kind: entity.kind,
      name: entity.name,
      // `?? undefined`: documents written before ignoreUndefined was set hold nulls.
      category: entity.category ?? undefined,
      address: entity.address ?? undefined,
      url: entity.url ?? undefined,
      platformRating: entity.rating ?? undefined,
      platformReviewCount: entity.reviewCount ?? undefined,
      role: entity.tracking.role,
      competitorOf: entity.tracking.competitorOf ?? undefined,
      addedAt: entity.tracking.addedAt.toISOString(),
      sync: entity.sync ?? { state: "idle" },
      storedReviews,
      analysedReviews,
      headline: report
        ? {
            averageRating: report.stats.averageRating,
            positiveShare: report.stats.analysedCount ? report.stats.sentiment.positive / report.stats.analysedCount : 0,
            suspicious: report.stats.suspiciousReviewIds.length,
            generatedAt: report.generatedAt.toISOString(),
          }
        : undefined,
    };
  }

  async function tracked(key: string) {
    const entity = await mongo.entities.findOne({ _id: key, tracking: { $exists: true } });
    if (!entity?.tracking) throw new NotFoundError(`No tracked business "${key}"`);
    return entity as EntityDoc & { tracking: NonNullable<EntityDoc["tracking"]> };
  }

  async function startTracking(entity: EntityDoc, role: "business" | "competitor", competitorOf?: string) {
    if (competitorOf) await tracked(competitorOf);
    const { _id, ...fields } = entity;
    await mongo.entities.updateOne({ _id }, { $set: { ...fields, tracking: { role, competitorOf, addedAt: new Date() } } }, { upsert: true });
    await mongo.entities.updateOne({ _id: entity._id, "sync.state": { $nin: ["running"] } }, { $set: { sync: { state: "queued", message: "Waiting to sync" } } });
    if (competitorOf) await graph.linkCompetitor(competitorOf, entity._id);
    await queue.enqueue(entity._id, "added");
    if (entity.source !== IMPORT_SOURCE) await queue.schedule(entity._id);
    return detail(entity._id);
  }

  async function detail(key: string): Promise<BusinessDetail> {
    const entity = await tracked(key);
    const report = await mongo.reports.findOne({ _id: key });
    return { business: await summarize(entity, report), report: toReport(report, key) };
  }

  return {
    async list(): Promise<BusinessSummary[]> {
      const entities = await mongo.entities.find({ tracking: { $exists: true } }).sort({ "tracking.addedAt": 1 }).toArray();
      const reports = new Map((await mongo.reports.find({ _id: { $in: entities.map((e) => e._id) } }).toArray()).map((r) => [r._id, r]));
      return Promise.all(entities.map((e) => summarize(e as Parameters<typeof summarize>[0], reports.get(e._id) ?? null)));
    },

    detail,

    async track(input: TrackRequest) {
      const { entity, role, competitorOf } = TrackRequestSchema.parse(input);
      const key = entityKeyOf(entity.ref);
      return startTracking(
        { _id: key, source: entity.ref.source, externalId: entity.ref.externalId, kind: entity.kind, name: entity.name, category: entity.category, address: entity.address, url: entity.url, rating: entity.rating, reviewCount: entity.reviewCount },
        role,
        competitorOf,
      );
    },

    /** Pasted or exported reviews become a business like any other; its reviews are stored now and processed by the sync. */
    async importReviews(input: ImportRequest) {
      const { name, kind, category, reviews, role, competitorOf } = ImportRequestSchema.parse(input);
      const externalId = createHash("sha256").update(JSON.stringify([name, reviews.map((r) => [r.text, r.rating])])).digest("hex").slice(0, 16);
      const key = entityKeyOf({ source: IMPORT_SOURCE, externalId });
      await mongo.reviews.bulkWrite(
        reviews.map((r) => ({
          updateOne: { filter: { _id: reviewKey(key, r.id) }, update: { $set: { ...r, entityKey: key, source: IMPORT_SOURCE, storedAt: new Date() } }, upsert: true },
        })),
      );
      return startTracking({ _id: key, source: IMPORT_SOURCE, externalId, kind, name, category, reviewCount: reviews.length }, role, competitorOf);
    },

    async sync(key: string) {
      await tracked(key);
      await mongo.entities.updateOne({ _id: key, "sync.state": { $ne: "running" } }, { $set: { "sync.state": "queued", "sync.message": "Waiting to sync" } });
      await queue.enqueue(key, "manual");
      return detail(key);
    },

    /** Stops tracking and deletes everything derived for the business (its competitors stay tracked). */
    async untrack(key: string) {
      await tracked(key);
      await queue.unschedule(key);
      await graph.removeEntity(key);
      await Promise.all([
        mongo.reviews.deleteMany({ entityKey: key }),
        mongo.analyses.deleteMany({ entityKey: key }),
        mongo.reports.deleteOne({ _id: key }),
        mongo.entities.deleteOne({ _id: key }),
        pg.query(`DELETE FROM review_search WHERE entity_key = $1`, [key]),
        pg.query(`DELETE FROM review_events WHERE entity_key = $1`, [key]),
      ]);
      await mongo.entities.updateMany({ "tracking.competitorOf": key }, { $unset: { "tracking.competitorOf": "" } });
    },

    async status(key: string) {
      const entity = await tracked(key);
      return entity.sync ?? { state: "idle" as const };
    },

    async reviews(key: string, filter: "all" | "suspicious" | "negative"): Promise<ReviewItem[]> {
      await tracked(key);
      const [reviews, analyses, report] = await Promise.all([
        mongo.reviews.find({ entityKey: key, text: { $ne: "" } }).sort({ createdAt: -1 }).toArray(),
        mongo.analyses.find({ entityKey: key }).toArray(),
        mongo.reports.findOne({ _id: key }),
      ]);
      const sentiment = new Map(analyses.map((a) => [a.reviewId, a.sentiment]));
      const flags = new Map<string, string[]>();
      const flag = (id: string, why: string) => flags.set(id, [...(flags.get(id) ?? []), why]);
      for (const id of report?.stats.ratingMismatches ?? []) flag(id, "Star rating contradicts the text");
      for (const group of report?.stats.duplicateGroups ?? []) {
        for (const id of group) flag(id, group.length === 2 ? "Near-identical to another review" : `Near-identical to ${group.length - 1} other reviews`);
      }

      return reviews
        .map((r) => ({ id: r.id, text: r.text, rating: r.rating, createdAt: r.createdAt, sentiment: sentiment.get(r.id), flags: flags.get(r.id) ?? [] }))
        .filter((r) => (filter === "suspicious" ? r.flags.length > 0 : filter === "negative" ? r.sentiment === "negative" : true));
    },

    async compare(key: string): Promise<Comparison> {
      const business = await tracked(key);
      const competitors = await mongo.entities.find({ "tracking.role": "competitor", "tracking.competitorOf": key }).toArray();
      const all = [business, ...competitors];
      const reports = new Map((await mongo.reports.find({ _id: { $in: all.map((e) => e._id) } }).toArray()).map((r) => [r._id, r]));
      return {
        businesses: all.map((e) => {
          const report = reports.get(e._id);
          return {
            key: e._id,
            name: e.name,
            role: e.tracking!.role,
            averageRating: report?.stats.averageRating ?? null,
            analysedReviews: report?.stats.analysedCount ?? 0,
            aspects: Object.fromEntries((report?.stats.aspects ?? []).map((a) => [a.aspect, { score: a.score, mentions: a.mentions }])),
            topPraise: (report?.stats.praise ?? []).slice(0, 3).map((c) => c.claim),
            topComplaints: (report?.stats.complaints ?? []).slice(0, 3).map((c) => c.claim),
          };
        }),
      };
    },
  };
}

export type BusinessService = ReturnType<typeof createBusinessService>;
