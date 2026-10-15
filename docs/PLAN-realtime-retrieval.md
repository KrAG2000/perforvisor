# Plan: real-time retrieval and multiple models

Status: agreed 2026-10-15. **Update 2026-10-16:** the consumer live-lookup path is in the backlog (REQUIREMENTS BL-2) and is redesigned to be **location-aware**; see [Consumer lookup: location-aware](#consumer-lookup-location-aware). Work continues on the client (owner/seller) app. Models and databases run locally first; cloud (GKE, Tiger Cloud, MongoDB Atlas) once the local version is stable.

## Goal

A consumer asks about any place or product ("Does the VoltMax power bank overheat?", "Is the biryani at Paradise worth it?"). Perforvisor:

1. works out what they're asking about,
2. fetches its reviews live if it doesn't have fresh ones,
3. finds the reviews that actually answer the question,
4. answers with citations,

with visible progress the whole way. Owners get the same pipeline on a schedule for the places and products they track.

Today the answer step reads every review with keyword matching and a 0.6B model, and only for two built-in samples. That's what this plan replaces.

## Two halves

| | What it means | Today | After |
|---|---|---|---|
| **Live acquisition** | Getting reviews from platforms on demand | Built-in samples only; SerpApi plugin disabled | SerpApi connectors on, resolved and fetched per question, cached |
| **Retrieval** | Picking the reviews that answer a question | Keyword overlap | Cosine similarity over EmbeddingGemma 2 vectors; qwen3-4b picks citations |

## Model roles

vLLM serves one model per server, so each role is its own deployment behind its own OpenAI-compatible endpoint.

| Role | Used for | Model (vLLM id) | Size | Notes |
|---|---|---|---|---|
| **Chat** | Understanding the question, writing answers and advice, choosing citations | **qwen3-4b** → `Qwen/Qwen3-4B-AWQ` | 4.0B (4-bit, ~2.5 GB) | Chosen by the user. Thinking off (`enable_thinking: false`). Apache-2.0. |
| **Extraction** | Per-review sentiment, aspects, claims (high volume) | Same as chat | — | Later: a small fine-tuned model. |
| **Embedding** | Turning reviews and questions into vectors | **EmbeddingGemma 2** → `google/embeddinggemma-2` | 0.74B | Chosen by the user. 768 dims (Matryoshka: truncatable to 512/256/128). Apache-2.0. Needs a vLLM nightly and a small kernel patch on consumer GPUs (see `docker-compose.yml`). |
| ~~Reranker~~ | — | ~~gemma3:1b~~ | — | **Removed 2026-10-15 (user's decision).** Evaluated as an LLM judge: it lowered recall@3 from 0.86 to 0.63 (scored "overheated on a flight" 2/10 for "Does it overheat?"; answered "yes" to every review in yes/no form). Instead, retrieval ranks by cosine similarity and qwen3-4b, reading the top 8 while answering, decides which reviews to cite. |



**Local first (laptop, CPU, 15 GB RAM):** everything runs locally until the local version is stable. Rough memory: qwen3-4b ~8 GB weights + gemma3:1b ~2 GB + embedding ~1.2 GB + KV caches + MongoDB and Postgres (~1.5 GB). That is close to the machine's total, so KV caches are kept small and each model can be switched off with a flag while working on other parts.

### Backend: model registry

Replace the single `LLM_*` config with one entry per role:

```
CHAT_BASE_URL / CHAT_MODEL
EXTRACT_BASE_URL / EXTRACT_MODEL      (defaults to chat)
EMBED_BASE_URL / EMBED_MODEL / EMBED_DIMENSIONS
ASK_TOP_K                              (reviews the answer step reads; default 8)
```

`/v1/ai/health` reports each role separately.

## Pipeline: consumer question (LangGraph)

> Superseded for the resolve step by [Consumer lookup: location-aware](#consumer-lookup-location-aware): resolving by name alone picks the wrong "Paradise restaurant". The rest of the pipeline below still applies.

```
understand ─► resolve ─► fresh? ──yes──────────────────────────► retrieve (cosine, top 8) ─► answer
                 │          └─no─► fetch ─► store ─► embed ─────┘
                 └─ ambiguous ─► ask the user to pick (SSE "choices" event) ─► resume
```

| Node | Does | Model | Notes |
|---|---|---|---|
| understand | Parses the question into `{subject, platformHint, focus}` (e.g. subject "VoltMax power bank", platform "amazon", focus "overheating") | Chat | Structured output |
| resolve | Searches connectors for the subject | — | One SerpApi search. Several plausible matches → stream them to the UI and pause (LangGraph `interrupt`, resumed by the user's choice) |
| fresh? | Has this entity been synced within the TTL (default 24 h)? | — | Skips fetching entirely for repeat questions |
| fetch | Pulls reviews, newest first, up to a page budget | — | Streams "Fetched 40 reviews…" |
| store | Upserts entity and reviews into MongoDB (dedupe by `(source, externalId)`) and the search rows into Postgres | — | |
| embed | Embeds only reviews that don't have vectors yet | Embedding | Batched; cheap |
| retrieve | Cosine similarity in Tiger Data (Postgres + pgvector): the top 8 reviews of this entity (`ASK_TOP_K`) | Embedding (question) | Full-text and hybrid were evaluated and dropped: on the samples, cosine alone ranked best (MRR 0.89 vs 0.81 hybrid) |
| answer | Answers from the top 8 with citations; citations are checked against what it was shown | Chat | Answer also states coverage: "3 of 41 reviews mention…" |

**Extraction is moved off the question path.** Per-review extraction (aspects, claims, trust signals) is the slow part and isn't needed to answer a question. After `store`, the worker gets a BullMQ job that extracts and enriches the graph in the background; the owner dashboard and claim counts use it.

Latency targets: entity already fresh: under 10 s. New entity: under 30 s, mostly fetching.

## Live acquisition

| Source | Via | What we get | Cost |
|---|---|---|---|
| Google Maps | SerpApi `google_maps` (search) + `google_maps_reviews` | Full review list, paginated, newest first | 1 search to resolve, 1 per page of reviews |
| Amazon | SerpApi Amazon Search + Amazon Product API | Product details, rating histogram, **Amazon's review summary and per-topic insights with mention counts**, and a handful of top reviews. **Not** the full review list. | 1 search + 1 product call |
| Anything else | CSV import (exists in requirements as ING-3) | Whatever the owner exports | Free |

Amazon's per-topic insights ("Coffee quality: 1,600 mentions, 1,330 positive") are stored as aggregate signals next to the individual reviews, so answers about Amazon products can cite both.

**Quota guard (SerpApi free tier: 250 searches/month):** every SerpApi call goes through a Redis counter with a monthly cap and a per-question page budget (default 3 pages). Raw responses are cached in Redis for the TTL. When the cap is hit, answers fall back to stored data and say so.

## Storage

| Store | Holds | Why |
|---|---|---|
| **MongoDB** (sponsor) | Source of truth: entities, reviews, sync state. **Knowledge graph**: `nodes` (entity, aspect, claim, seller, brand) and `edges` collections, traversed with `$graphLookup` | Document upserts fit connector output; `$graphLookup` covers our relationship queries without a dedicated graph database |
| **Tiger Data** (sponsor, Postgres) | Retrieval index: review text + embeddings (pgvector). Time series: ratings and sentiment over time (TimescaleDB hypertables) | Cosine-similarity search per entity; trends and burst detection (TRU-1) |
| Redis | Queues, SerpApi cache and quota counter | Already running |

Review text is written to both: MongoDB keeps the full record, Postgres keeps what search needs (id, entity, text, rating, date, embedding).

Locally both run in `docker-compose.yml` (`mongodb/mongodb-atlas-local`, Timescale's Postgres image with pgvector). In the cloud: MongoDB Atlas and Tiger Cloud. Neo4j is not used.

## Consumer lookup: location-aware

Status: designed 2026-10-16, not built (REQUIREMENTS BL-2).

### Why

A name is not an identity. There are many restaurants called "Paradise" and many products called "Trusted protein shake" around the world; the one a shopper means depends on where they are. Resolving by name alone (the original `resolve` step) returns whichever match the search engine ranks first, often in another city or country, and the answer is then about the wrong business. Every consumer lookup is therefore anchored to the user's location: their area for places, their market (country, and optionally postcode) for products.

### Where the location comes from

In order of preference; the user can always change it.

| Source | Gives | Notes |
|---|---|---|
| Browser geolocation (`navigator.geolocation`), with the user's permission | Latitude and longitude | Rounded to 2 decimals (~1 km) in the browser before it is sent anywhere |
| City picker | City, region, country code | Autocomplete from SerpApi's Locations API (`/locations.json`), which is free and doesn't count against the search quota |
| Previous choice | Same as above | Remembered in the browser only (localStorage) |

If neither is available the app asks for a city instead of guessing. No IP geolocation. The location is sent to the backend in the request body (never in a URL), is not stored with any user identity, and is only passed on to SerpApi as search parameters.

The header of the consumer app shows it as a chip, e.g. "Near Secunderabad, IN · change".

### Places (restaurants, shops, services)

Engine: SerpApi **Google Maps**, `type=search`.

| Parameter | Value | Why |
|---|---|---|
| `q` | The subject from the question ("Paradise restaurant") | |
| `ll` | `@<lat>,<lng>,<zoom>z` from the user's location; zoom 14z by default (neighbourhood), 12z when the question names a wider area, 15z for "near me" | Search origin (format per SerpApi docs, e.g. `@17.44,78.49,14z`) |
| `location` + `z` | Instead of `ll` when the user picked a city rather than sharing coordinates | `location` and `ll` can't be combined |
| `nearby=true` | Only for "near me"-style questions | SerpApi recommends it for "near me" queries and advises against it when `q` already names a place |
| `gl`, `hl` | Country code and language from the location | Localises results |

SerpApi notes that results are *not guaranteed* to fall inside the `ll` area, so the backend also:

1. computes the distance from the user to each result (`gps_coordinates`, haversine),
2. drops results further than a cut-off (default 25 km; widened when the question names a city),
3. ranks the rest by name match first, then distance,
4. when more than one plausible match remains, streams a `choices` event (name, address, distance, rating, review count) and pauses the LangGraph run (`interrupt`); the user's pick resumes it.

Once a place is chosen its `place_id` identifies it everywhere; fetching its reviews (`google_maps_reviews`) needs no location.

### Products

For products the location means the **market**: which store and which listing the shopper can actually buy.

| Engine | Location parameters |
|---|---|
| SerpApi **Amazon Search** | `amazon_domain` from the country (IN → `amazon.in`, US → `amazon.com`, UK → `amazon.co.uk`, DE → `amazon.de`, JP → `amazon.co.jp`, …); `language`; optional `delivery_zip` (postcode) and `shipping_location` to keep to products that ship to the user |
| SerpApi **Google Shopping** (for products not on Amazon) | `location` (city level, as SerpApi recommends), `gl`, `hl` |

The product is then fetched with the Amazon Product API on the same domain: rating histogram, Amazon's review summary and per-topic insights, and the top reviews (Amazon doesn't expose the full review list through SerpApi). Products with the same name on different Amazon domains are different listings with different reviews, which is exactly why the domain matters.

### Pipeline changes

```
understand ─► locate ─► resolve (location-aware) ─► one clear match? ──yes──► fresh? … (as before) ─► answer
   │                          │                        └─no─► choices (SSE) ─► user picks ─► resume
   └─ place or product?       └─ places: Google Maps with ll/location; products: Amazon on the user's domain
```

| Node | Change |
|---|---|
| understand | Also returns `kind` (place or product), whether the question is "near me", and any place named in it ("in Secunderabad"), which overrides the user's own location |
| locate (new) | Turns the request's location into engine parameters: `ll` / `location` + `z`, `gl`, `hl`, `amazon_domain`, `delivery_zip` |
| resolve | Runs the engine for the kind with those parameters, filters and ranks by distance (places) |
| choices | Pauses for the user's pick when the match isn't clear |

Request shape (consumer): `{ question, location: { lat, lng } | { city, countryCode, postcode? } }`.

### Caching and quota

- Search responses are cached per query and **rounded** location (2 decimals ≈ 1.1 km), so shoppers in the same area share results; the existing SerpApi guard (24 h cache, monthly budget) applies.
- A resolved place or product is cached by its id, independent of the asker's location; its reviews follow the normal sync and freshness rules.
- Typical cost of a new consumer question: 1 search to resolve + 1–3 to fetch reviews; repeat questions about the same subject nearby: 0.

### How to test

| Test | Expected |
|---|---|
| "Is Paradise restaurant good?" with a location in Secunderabad, then the same question from a location in another city | Different restaurants, each near the given location; reviews and answers differ |
| "Best biryani near me" with coordinates | `nearby=true`; results within the cut-off, sorted by distance |
| "Is Paradise in Secunderabad good?" asked from another city | The named area wins over the user's location |
| "Is Trusted protein shake any good?" with country IN, then US | `amazon.in` vs `amazon.com` listings; different reviews |
| Two branches of the same chain in one city | A `choices` step listing both with addresses and distances |
| Location permission denied | The app asks for a city instead of searching worldwide |

## Kubernetes and compose

- `deploy/k8s/base` grows from one `vllm` Deployment to two: `vllm-chat` and `vllm-embed`, each with its own Service and settings; the CPU/GPU components apply to each.
- Recommended GKE layout: embed on the C3 CPU pool (small model, fast enough on AVX-512/AMX); chat on CPU now, on an L4 later. If both move to one L4, enable GKE GPU time-sharing so the two pods share it.
- `docker-compose.yml`: one service per role under the `llm-cpu` and `llm-gpu` profiles, plus a `llm-lite` profile (embedding + small chat only) for the laptop.

## Evaluation

A small labelled set per sample dataset: ~15 questions, each with the review ids that truly answer it (e.g. "Does it overheat?" → p2, p5, p10). Measured for keyword (before) and cosine similarity, plus the citations in the final answers:

- **Recall@8**: did the right reviews make it into what the model sees?
- **Citation precision**: are the cited reviews actually relevant?

This also gives the DEV post real numbers.

## Phases

Deadline: Sunday 2026-10-18, 11:59 PM PDT.

| Phase | Scope | Testable with |
|---|---|---|
| **1** (Thu 15) ✅ | Model registry; compose for chat and embeddings on the GPU; MongoDB collections; Postgres (pgvector) schema; index the samples; cosine retrieval in `/v1/ask`; evaluation set and first numbers; first SerpApi round trip | Samples |
| **2** (Fri 16) | SerpApi connectors on (Google Maps reviews, Amazon product); quota guard and cache; `understand → resolve → fetch` path with live progress and the "pick one" step; consumer UI for free-text subjects | Real places and products |
| **3** (Sat 17) | Background extraction in the worker; knowledge graph in MongoDB built from it; rating time series in TimescaleDB; owner watchlist with scheduled re-sync; re-run evaluation | Both apps end to end |
| **Sun 18** | Polish, demo, DEV post | |

## Decisions

1. Models run **locally** until the local version is stable, then move to GKE.
2. **SerpApi free tier** comes out of the backlog, behind the quota guard.
3. Models: chat **qwen3-4b** (`Qwen/Qwen3-4B-AWQ`, the official 4-bit build; thinking off); embedding **EmbeddingGemma 2** (`google/embeddinggemma-2`). No reranker: cosine similarity, top 8, and qwen3-4b decides what to cite.
4. Storage: **MongoDB** (source of truth + knowledge graph) and **Tiger Data / Postgres** (embeddings, cosine search, time series), both sponsors, both in Docker locally. No Neo4j. (TigerGraph is an unrelated company and not a sponsor.)

## Phase 1 results (2026-10-15, RTX 4060 8 GB)

12 labelled questions over the two samples (`pnpm --filter @perforvisor/backend eval:retrieval`):

| Ranking | Recall@3 | MRR | Recall@8 |
|---|---|---|---|
| Keyword overlap (before) | 0.56 | 0.69 | 0.60 |
| Cosine similarity (EmbeddingGemma 2) | 0.86 | 0.89 | 0.98 |

Answers (qwen3-4b reading the top 8): citation precision 0.79, recall 0.79, median 1.0 s per answer. Small test set: indicative, not conclusive.
