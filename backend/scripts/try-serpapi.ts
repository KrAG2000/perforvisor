/**
 * One real, cheap SerpApi round trip: 1 Google Maps search + 1 page of reviews (2 searches),
 * stored and indexed like any other entity. Prints the quota before and after
 * (the account endpoint is free).
 * Run: pnpm --filter @perforvisor/backend try:serpapi "Paradise Biryani Secunderabad"
 */
import { loadConfig } from "../src/config.ts";
import { connectMongo } from "../src/db/mongo.ts";
import { connectPostgres } from "../src/db/postgres.ts";
import { indexReviews } from "../src/retrieval/store.ts";
import plugin from "@perforvisor/plugin-serpapi-google-maps";

const query = process.argv[2];
if (!query) throw new Error('Usage: try:serpapi "<place name and city>"');

const config = loadConfig();
const quota = async () => {
  const res = await fetch(`https://serpapi.com/account.json?api_key=${process.env.SERPAPI_API_KEY}`);
  return ((await res.json()) as { plan_searches_left?: number }).plan_searches_left;
};

const log = { debug: () => {}, info: console.log, warn: console.warn, error: console.error };
const connector = plugin.create(plugin.configSchema.parse(process.env), { log, fetch });

console.log("searches left before:", await quota());
const [place] = await connector.search(query);
if (!place) throw new Error(`No Google Maps result for "${query}"`);
console.log(`place: ${place.name} | ${place.address} | ${place.rating}★ from ${place.reviewCount} reviews | id ${place.ref.externalId}`);

const page = await connector.fetchReviews(place.ref);
console.log(`fetched ${page.reviews.length} reviews (more pages: ${Boolean(page.nextCursor)})`);

const mongo = await connectMongo(config);
const pg = await connectPostgres(config);
const entityKey = `${place.ref.source}:${place.ref.externalId}`;
const result = await indexReviews(
  config,
  { mongo, pg },
  { _id: entityKey, source: place.ref.source, externalId: place.ref.externalId, kind: "place", name: place.name, category: place.category, address: place.address, rating: place.rating, reviewCount: place.reviewCount, raw: place.raw },
  page.reviews.map((r) => ({ id: r.externalId, text: r.text, rating: r.rating ?? undefined, createdAt: r.createdAt, authorHash: r.authorHash, raw: r.raw })),
);
console.log(`stored ${result.stored}, embedded ${result.embedded} under ${entityKey}`);
for (const r of page.reviews.slice(0, 3)) console.log(` - ${r.rating}★ ${r.createdAt.slice(0, 10)} ${r.text.slice(0, 110)}`);
console.log("searches left after:", await quota());

await mongo.client.close();
await pg.end();
