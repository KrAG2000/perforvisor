import { z } from "zod";
import {
  BusinessDetail,
  BusinessSummary,
  Comparison,
  Entity,
  KnowledgeGraph,
  ReviewItem,
  Trends,
  type ImportRequest,
  type TrackRequest,
} from "@perforvisor/core";

export class ApiError extends Error {}

async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    throw new ApiError(body?.message ?? `Request failed (${res.status})`);
  }
  return schema.parse(await res.json());
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const enc = encodeURIComponent;

export const api = {
  sources: () => request("/v1/sources", z.array(z.object({ source: z.string(), name: z.string() }))),
  search: (source: string, q: string) => request(`/v1/search?source=${enc(source)}&q=${enc(q)}`, z.array(Entity.omit({ raw: true }))),
  serpapiUsage: () => request("/v1/usage/serpapi", z.object({ month: z.string(), used: z.number(), budget: z.number() })),

  businesses: () => request("/v1/businesses", z.array(BusinessSummary)),
  business: (key: string) => request(`/v1/businesses/${enc(key)}`, BusinessDetail),
  track: (body: TrackRequest) => request("/v1/businesses", BusinessDetail, json("POST", body)),
  importReviews: (body: ImportRequest) => request("/v1/businesses/import", BusinessDetail, json("POST", body)),
  sync: (key: string) => request(`/v1/businesses/${enc(key)}/sync`, BusinessDetail, { method: "POST" }),
  untrack: async (key: string) => {
    const res = await fetch(`/v1/businesses/${enc(key)}`, { method: "DELETE" });
    if (!res.ok) throw new ApiError(`Couldn't remove it (${res.status})`);
  },
  reviews: (key: string, filter: "all" | "suspicious" | "negative") => request(`/v1/businesses/${enc(key)}/reviews?filter=${filter}`, z.array(ReviewItem)),
  trends: (key: string) => request(`/v1/businesses/${enc(key)}/trends`, Trends),
  graph: (key: string) => request(`/v1/businesses/${enc(key)}/graph`, KnowledgeGraph),
  compare: (key: string) => request(`/v1/businesses/${enc(key)}/compare`, Comparison),
  syncEventsUrl: (key: string) => `/v1/businesses/${enc(key)}/sync/events`,
};
