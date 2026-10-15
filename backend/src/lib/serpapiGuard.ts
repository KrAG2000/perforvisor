import { createHash } from "node:crypto";
import type { Redis } from "ioredis";
import type { Config } from "../config.ts";

export class SerpApiBudgetError extends Error {}

/**
 * fetch wrapper for plugins. Calls to serpapi.com are cached in Redis (identical requests
 * within the TTL are served from cache) and counted against a monthly budget; once the
 * budget is used up, further calls fail instead of spending searches. Other hosts pass through.
 */
export function guardedFetch(redis: Redis, config: Config): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.hostname !== "serpapi.com") return fetch(input, init);

    const params = new URLSearchParams(url.searchParams);
    params.delete("api_key");
    params.sort();
    const cacheKey = `serpapi:cache:${createHash("sha256").update(`${url.pathname}?${params}`).digest("hex")}`;
    const cached = await redis.get(cacheKey);
    if (cached) return new Response(cached, { status: 200, headers: { "Content-Type": "application/json", "X-Perforvisor-Cache": "hit" } });

    const month = new Date().toISOString().slice(0, 7);
    const usageKey = `serpapi:usage:${month}`;
    const used = Number(await redis.get(usageKey)) || 0;
    if (used >= config.SERPAPI_MONTHLY_BUDGET) {
      throw new SerpApiBudgetError(`SerpApi budget for ${month} used up (${used}/${config.SERPAPI_MONTHLY_BUDGET} searches). Raise SERPAPI_MONTHLY_BUDGET or wait for next month.`);
    }

    const res = await fetch(input, init);
    await redis.multi().incr(usageKey).expire(usageKey, 60 * 60 * 24 * 40).exec();
    const body = await res.text();
    if (res.ok) await redis.set(cacheKey, body, "EX", config.SERPAPI_CACHE_HOURS * 3600);
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export async function serpApiUsage(redis: Redis, config: Config) {
  const month = new Date().toISOString().slice(0, 7);
  return { month, used: Number(await redis.get(`serpapi:usage:${month}`)) || 0, budget: config.SERPAPI_MONTHLY_BUDGET };
}
