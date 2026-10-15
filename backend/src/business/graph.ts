import { createHash } from "node:crypto";
import { z } from "zod";
import type { Aspect, KnowledgeGraph, Sentiment } from "@perforvisor/core";
import type { Config } from "../config.ts";
import type { AnalysisDoc, EdgeDoc, Mongo, NodeDoc, ReportDoc } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import { embedClaims } from "../ai/embed.ts";
import { createChatModel } from "../ai/model.ts";
import { claimSentiment } from "../ai/stats.ts";

/*
 * Claim merging. Measured on EmbeddingGemma 2 (sentence-similarity prompt): same-meaning
 * pairs scored 0.867-0.957, different pairs 0.772-0.912, so no single cut-off works.
 * Candidates must share entity, sentiment and aspect; >= AUTO merges; [ASK, AUTO) asks the
 * chat model, whose prompt below never merged different items in testing (it errs towards
 * keeping claims apart, the safer mistake for counts).
 */
const AUTO_MERGE = 0.93;
const ASK_MERGE = 0.86;

const SAME_CLAIM_PROMPT = (a: string, b: string) => `Two statements from customer reviews of the same business:
A: "${a}"
B: "${b}"
Do they report the same issue or praise the same specific thing, so they should be counted together?
If they name different dishes, products, parts or features, answer no. Answer yes or no.`;

const nodeId = {
  entity: (entityKey: string) => `entity:${entityKey}`,
  aspect: (entityKey: string, aspect: Aspect) => `aspect:${entityKey}:${aspect}`,
  claim: (entityKey: string, text: string) => `claim:${entityKey}:${createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16)}`,
};
const edgeId = (from: string, type: EdgeDoc["type"], to: string) => `${from}|${type}|${to}`;

export function createGraphBuilder(config: Config, stores: { mongo: Mongo; pg: Postgres }) {
  const judge = createChatModel(config, { temperature: 0, maxTokens: 5 }).withStructuredOutput(z.object({ same: z.enum(["yes", "no"]) }), {
    name: "same_claim",
    method: "jsonSchema",
  });
  const sameClaim = async (a: string, b: string) => {
    try {
      return (await judge.invoke([{ role: "user", content: `${SAME_CLAIM_PROMPT(a, b)}\nRespond with JSON: {"same": "yes" | "no"}.` }])).same === "yes";
    } catch {
      return false;
    }
  };

  /** Adds the claims of newly analysed reviews to the entity's graph, merging similar ones. */
  async function addAnalyses(entityKey: string, entityName: string, analyses: AnalysisDoc[], reviewDates: Map<string, Date | undefined>, signal?: AbortSignal) {
    const { mongo, pg } = stores;
    const entityNode = nodeId.entity(entityKey);
    await mongo.nodes.updateOne({ _id: entityNode }, { $set: { type: "entity", entityKey, label: entityName } }, { upsert: true });

    const claims = analyses.flatMap((a) =>
      a.claims.map((c) => ({ text: c.text.trim(), aspect: c.aspect, sentiment: claimSentiment(a, c.aspect), reviewId: a.reviewId })),
    ).filter((c) => c.text.length > 0);
    if (!claims.length) return { added: 0, merged: 0 };

    const vectors = await embedClaims(config, claims.map((c) => c.text), signal);
    let added = 0;
    let merged = 0;

    for (const [i, claim] of claims.entries()) {
      const vector = JSON.stringify(vectors[i]);
      const seenAt = reviewDates.get(claim.reviewId);
      const { rows } = await pg.query<{ node_id: string; text: string; similarity: number }>(
        `SELECT node_id, text, 1 - (embedding <=> $3::vector) AS similarity
         FROM claim_vectors WHERE entity_key = $1 AND sentiment = $2
         ORDER BY embedding <=> $3::vector LIMIT 3`,
        [entityKey, claim.sentiment, vector],
      );
      // Same aspect is required too; the aspect lives on the Mongo node.
      let target: string | null = null;
      for (const row of rows) {
        const similarity = Number(row.similarity);
        if (similarity < ASK_MERGE) break;
        const node = await mongo.nodes.findOne({ _id: row.node_id }, { projection: { aspect: 1 } });
        if (node?.aspect !== claim.aspect) continue;
        if (similarity >= AUTO_MERGE || (await sameClaim(claim.text, row.text))) {
          target = row.node_id;
          break;
        }
      }

      if (target) {
        merged++;
        const node = await mongo.nodes.findOne({ _id: target });
        const variants = node?.variants ?? [];
        const isNewWording = node && node.label.toLowerCase() !== claim.text.toLowerCase() && !variants.some((v) => v.toLowerCase() === claim.text.toLowerCase());
        await mongo.nodes.updateOne(
          { _id: target },
          {
            $addToSet: { reviewIds: claim.reviewId, ...(isNewWording ? { variants: claim.text } : {}) },
            ...(seenAt ? { $min: { firstSeen: seenAt }, $max: { lastSeen: seenAt } } : {}),
          },
        );
      } else {
        added++;
        target = nodeId.claim(entityKey, `${claim.sentiment}:${claim.text}`);
        await mongo.nodes.updateOne(
          { _id: target },
          {
            $set: { type: "claim", entityKey, label: claim.text, aspect: claim.aspect, sentiment: claim.sentiment },
            $addToSet: { reviewIds: claim.reviewId },
            ...(seenAt ? { $min: { firstSeen: seenAt }, $max: { lastSeen: seenAt } } : {}),
          },
          { upsert: true },
        );
        await pg.query(
          `INSERT INTO claim_vectors (node_id, entity_key, sentiment, text, embedding) VALUES ($1, $2, $3, $4, $5::vector)
           ON CONFLICT (node_id) DO NOTHING`,
          [target, entityKey, claim.sentiment, claim.text, vector],
        );
      }

      const aspectNode = nodeId.aspect(entityKey, claim.aspect);
      await mongo.nodes.updateOne({ _id: aspectNode }, { $set: { type: "aspect", entityKey, label: claim.aspect, aspect: claim.aspect } }, { upsert: true });
      await mongo.edges.updateOne({ _id: edgeId(target, "ABOUT", aspectNode) }, { $set: { from: target, to: aspectNode, type: "ABOUT", weight: 1 } }, { upsert: true });
      await mongo.edges.updateOne({ _id: edgeId(entityNode, "HAS_CLAIM", target) }, { $set: { from: entityNode, to: target, type: "HAS_CLAIM" }, $inc: { weight: 1 } }, { upsert: true });
    }

    // Entity -> aspect edges weighted by mentions (from all analyses, not just new ones).
    const mentions = await mongo.analyses
      .aggregate<{ _id: Aspect; n: number }>([{ $match: { entityKey } }, { $unwind: "$aspects" }, { $group: { _id: "$aspects.aspect", n: { $sum: 1 } } }])
      .toArray();
    for (const { _id: aspect, n } of mentions) {
      const aspectNode = nodeId.aspect(entityKey, aspect);
      await mongo.nodes.updateOne({ _id: aspectNode }, { $set: { type: "aspect", entityKey, label: aspect, aspect } }, { upsert: true });
      await mongo.edges.updateOne({ _id: edgeId(entityNode, "HAS_ASPECT", aspectNode) }, { $set: { from: entityNode, to: aspectNode, type: "HAS_ASPECT", weight: n } }, { upsert: true });
    }
    return { added, merged };
  }

  async function linkCompetitor(businessKey: string, competitorKey: string) {
    const from = nodeId.entity(businessKey);
    const to = nodeId.entity(competitorKey);
    await stores.mongo.edges.updateOne({ _id: edgeId(from, "COMPETES_WITH", to) }, { $set: { from, to, type: "COMPETES_WITH", weight: 1 } }, { upsert: true });
  }

  async function removeEntity(entityKey: string) {
    const { mongo, pg } = stores;
    const ids = (await mongo.nodes.find({ entityKey }, { projection: { _id: 1 } }).toArray()).map((n) => n._id);
    await mongo.edges.deleteMany({ $or: [{ from: { $in: ids } }, { to: { $in: ids } }] });
    await mongo.nodes.deleteMany({ entityKey });
    await pg.query(`DELETE FROM claim_vectors WHERE entity_key = $1`, [entityKey]);
  }

  return { addAnalyses, linkCompetitor, removeEntity };
}

export type GraphBuilder = ReturnType<typeof createGraphBuilder>;

/** Aspects with their merged claims, most-mentioned first; claim counts are distinct reviews. */
export async function readGraph(mongo: Mongo, entityKey: string, report: ReportDoc | null): Promise<KnowledgeGraph> {
  const nodes = await mongo.nodes.find({ entityKey }).toArray();
  const claimNodes = nodes.filter((n): n is NodeDoc & { aspect: Aspect; sentiment: Sentiment } => n.type === "claim" && !!n.aspect && !!n.sentiment);
  const edges = await mongo.edges.countDocuments({ from: { $in: nodes.map((n) => n._id) } });
  const suspicious = new Set(report?.stats.suspiciousReviewIds ?? []);

  const byAspect = new Map<Aspect, ReturnType<typeof toClaim>[]>();
  function toClaim(n: (typeof claimNodes)[number]) {
    const reviewIds = (n.reviewIds ?? []).filter((id) => !suspicious.has(id));
    return {
      id: n._id,
      text: n.label,
      sentiment: n.sentiment,
      aspect: n.aspect,
      count: reviewIds.length,
      reviewIds,
      variants: n.variants ?? [],
      firstSeen: n.firstSeen?.toISOString(),
      lastSeen: n.lastSeen?.toISOString(),
    };
  }
  for (const n of claimNodes) {
    const claim = toClaim(n);
    if (claim.count === 0) continue; // only backed by suspicious reviews
    byAspect.set(n.aspect, [...(byAspect.get(n.aspect) ?? []), claim]);
  }

  const aspectStats = new Map((report?.stats.aspects ?? []).map((a) => [a.aspect, a]));
  const aspects = [...byAspect.entries()]
    .map(([aspect, claims]) => ({
      aspect,
      mentions: aspectStats.get(aspect)?.mentions ?? claims.reduce((n, c) => n + c.count, 0),
      score: aspectStats.get(aspect)?.score ?? 0,
      claims: claims.sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.mentions - a.mentions);

  return { aspects, nodes: nodes.length, edges };
}
