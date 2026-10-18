import { createHash } from "node:crypto";
import type { Config } from "../config.ts";
import type { Mongo } from "../db/mongo.ts";

export class SerpApiBudgetError extends Error {}

const monthKey = () => new Date().toISOString().slice(0, 7);

/**
 * fetch wrapper for plugins. Calls to serpapi.com are cached in MongoDB (identical
 * requests within the TTL are served from cache; a TTL index deletes expired entries) and
 * counted against a monthly budget; once it's used up, further calls fail instead of
 * spending searches. Other hosts pass through.
 */
export function guardedFetch(mongo: Mongo, config: Config): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname !== "serpapi.com") return fetch(input, init);

    const params = new URLSearchParams(url.searchParams);
    params.delete("api_key");
    params.sort();
    const cacheKey = createHash("sha256").update(`${url.pathname}?${params}`).digest("hex");
    const cached = await mongo.serpapiCache.findOne({ _id: cacheKey, expiresAt: { $gt: new Date() } });
    if (cached) {
      return new Response(cached.body, {
        status: 200,
        headers: { "Content-Type": "application/json", "X-Perforvisor-Cache": "hit" },
      });
    }

    const month = monthKey();
    const used = (await mongo.serpapiUsage.findOne({ _id: month }))?.used ?? 0;
    if (used >= config.SERPAPI_MONTHLY_BUDGET) {
      throw new SerpApiBudgetError(
        `SerpApi budget for ${month} used up (${used}/${config.SERPAPI_MONTHLY_BUDGET} searches). Raise SERPAPI_MONTHLY_BUDGET or wait for next month.`,
      );
    }

    const res = await fetch(input, init);
    await mongo.serpapiUsage.updateOne({ _id: month }, { $inc: { used: 1 } }, { upsert: true });
    const body = await res.text();
    if (res.ok) {
      await mongo.serpapiCache.replaceOne(
        { _id: cacheKey },
        { body, expiresAt: new Date(Date.now() + config.SERPAPI_CACHE_HOURS * 3_600_000) },
        { upsert: true },
      );
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export async function serpApiUsage(mongo: Mongo, config: Config) {
  const month = monthKey();
  return { month, used: (await mongo.serpapiUsage.findOne({ _id: month }))?.used ?? 0, budget: config.SERPAPI_MONTHLY_BUDGET };
}
