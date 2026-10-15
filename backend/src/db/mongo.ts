import { MongoClient, type Collection } from "mongodb";
import type { AdvisorSummary, AnalysisReviewInput, AnalysisStats, Aspect, EntityKind, ReviewExtraction, Sentiment, SyncStatus, TrackRole } from "@perforvisor/core";
import type { Config } from "../config.ts";

export interface EntityDoc {
  _id: string; // entity key, e.g. "google_maps:ChIJ…", "sample:voltmax-power-bank"
  source: string;
  externalId: string;
  kind: EntityKind;
  name: string;
  category?: string;
  address?: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
  lastSyncedAt?: Date;
  raw?: unknown;
  /** Present for businesses the owner tracks (theirs or a competitor). */
  tracking?: { role: TrackRole; competitorOf?: string; addedAt: Date };
  sync?: SyncStatus;
}

export interface ReviewDoc extends AnalysisReviewInput {
  _id: string; // review key: "<entityKey>#<reviewId>"
  entityKey: string;
  source: string;
  authorHash?: string;
  raw?: unknown;
  storedAt: Date;
}

/** Model extraction for one review. */
export interface AnalysisDoc extends ReviewExtraction {
  _id: string; // review key
  entityKey: string;
  reviewId: string;
  ratingMismatch: boolean;
  model: string;
  analysedAt: Date;
}

export interface ReportDoc {
  _id: string; // entity key
  stats: AnalysisStats;
  summary: AdvisorSummary | null;
  generatedAt: Date;
}

/**
 * Knowledge graph. Nodes: entity, aspect (per entity), claim (per entity, similar wordings
 * merged). Edges: entity -HAS_ASPECT-> aspect, entity -HAS_CLAIM-> claim,
 * claim -ABOUT-> aspect, entity -COMPETES_WITH-> entity.
 */
export interface NodeDoc {
  _id: string;
  type: "entity" | "aspect" | "claim";
  entityKey: string;
  label: string;
  aspect?: Aspect;
  sentiment?: Sentiment;
  /** Claims: reviews that make this claim, and the other wordings merged into it. */
  reviewIds?: string[];
  variants?: string[];
  firstSeen?: Date;
  lastSeen?: Date;
}

export interface EdgeDoc {
  _id: string; // "<from>|<type>|<to>"
  from: string;
  to: string;
  type: "HAS_ASPECT" | "HAS_CLAIM" | "ABOUT" | "COMPETES_WITH";
  weight: number;
}

export interface Mongo {
  client: MongoClient;
  entities: Collection<EntityDoc>;
  reviews: Collection<ReviewDoc>;
  analyses: Collection<AnalysisDoc>;
  reports: Collection<ReportDoc>;
  nodes: Collection<NodeDoc>;
  edges: Collection<EdgeDoc>;
}

export async function connectMongo(config: Config): Promise<Mongo> {
  // ignoreUndefined: optional fields left undefined are omitted instead of stored as null.
  const client = new MongoClient(config.MONGO_URL, { ignoreUndefined: true });
  await client.connect();
  const db = client.db();
  const mongo: Mongo = {
    client,
    entities: db.collection("entities"),
    reviews: db.collection("reviews"),
    analyses: db.collection("analyses"),
    reports: db.collection("reports"),
    nodes: db.collection("nodes"),
    edges: db.collection("edges"),
  };
  await Promise.all([
    mongo.reviews.createIndex({ entityKey: 1, createdAt: -1 }),
    mongo.analyses.createIndex({ entityKey: 1 }),
    mongo.entities.createIndex({ "tracking.role": 1, "tracking.competitorOf": 1 }),
    mongo.nodes.createIndex({ entityKey: 1, type: 1 }),
    mongo.edges.createIndex({ from: 1, type: 1 }),
    mongo.edges.createIndex({ to: 1, type: 1 }),
  ]);
  return mongo;
}
