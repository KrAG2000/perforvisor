# Requirements

Product name: **Perforvisor**. Challenge deadline: Sun 2026-10-18, 11:59 PM PDT.

## Product in one paragraph

An AI advisor built on open-weight models that reads customer reviews and feedback from any platform with reviews (Google Maps and Amazon first, via SerpApi), turns them into a knowledge graph, and gives advice to two kinds of user:

- **Business owners and sellers**: how is my restaurant, shop or product actually doing, what are customers praising or complaining about, what is changing, which reviews look fake, and what should I fix first?
- **Consumers**: ask about anything that has reviews ("Is the biryani at X worth it?", "Do people say this power bank overheats?", "Are this seller's 5-star reviews real?") and get an answer that cites the evidence.

Out of scope: auto-replying to reviews.

## Tech stack (decided 2026-10-14)

| Area            | Choice                                                                                                                                                                                                                     |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language        | TypeScript everywhere, Node 24 (`.nvmrc`)                                                                                                                                                                                  |
| Package manager | pnpm 12 workspaces                                                                                                                                                                                                         |
| Backend         | Fastify 5 + `fastify-type-provider-zod`; SSE for streaming (`backend/src/lib/sse.ts`)                                                                                                                                      |
| Validation      | Zod 4, for requests, env config, connector payloads and model outputs                                                                                                                                                      |
| Background jobs | BullMQ + Redis; the worker is a second entry point in `backend` (`src/worker.ts`)                                                                                                                                          |
| Agent runtime   | LangGraph.js                                                                                                                                                                                                               |
| Model serving   | vLLM 0.31 (OpenAI-compatible API) on **CPU for now**, GPU-ready. Local: `docker compose --profile llm-cpu` (or `llm-gpu`). GKE: `deploy/k8s/overlays/gke-cpu` (C3 node pool) or `gke-gpu` (L4); see `deploy/gke/README.md` |
| Model           | `Qwen/Qwen3-0.6B` for development (lightest Qwen, ~1.5 GB); swap via `LLM_MODEL`                                                                                                                                           |
| Frontend        | React + Vite: `frontend/consumer` and `frontend/client`, each with its own minimal light and dark theme (after plane.so)                                                                                                   |
| Containers      | Docker; Kubernetes base manifests prepared, not deployed on day 1                                                                                                                                                          |

Workspace layout:

```
backend/            Fastify API + BullMQ worker (two start commands, one image)
frontend/consumer/  consumer app (@perforvisor/consumer)
frontend/client/    owner, seller and admin app (@perforvisor/client)
plugins/<id>/       one package per external integration (@perforvisor/plugin-<id>), loaded from the PLUGINS env var
common/core/        types, Zod schemas, plugin interface (browser-safe; Node-only helpers at @perforvisor/core/node)
common/ui/          shared React primitives and the theme system; colors and fonts are set by each app
```

---

## Users

| ID  | User                                                               | Main need                                                                                  |
| --- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| U1  | Business owner or seller (restaurant, grocery shop, Amazon seller) | Ongoing insight and advice about their own listings, and how they compare with competitors |
| U2  | Consumer                                                           | Trustworthy answers about any place or product before buying or visiting                   |

## Scope tiers

- **P0, first 3 days (Oct 14–16):** a working end-to-end product, deployed.
- **P1, days 4–5 (Oct 17–18):** remaining platform integrations, polish, first real user, DEV post.
- **P2, after the challenge:** the vision section of the post.

---

## P0: what can be done in 3 days

### Data ingestion

| ID    | Requirement                                                                                                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ING-1 | Google Maps connector via SerpApi: search for a place, then fetch its reviews (with pagination) and place metadata (name, address, category, rating, review count).                                                         |
| ING-2 | Amazon connector via SerpApi: look up a product by ASIN or URL, then fetch its reviews and product metadata (title, brand, seller, price, rating). Day 1 task: check how much review depth SerpApi's Amazon engines return. |
| ING-3 | Universal import: CSV upload with a column-mapping step, for platforms without an API (Flipkart or Blinkit exports, surveys).                                                                                               |
| ING-4 | Normalize everything into one standard review record: `source, external_id, entity_ref, rating, title, text, author_hash, created_at, verified, helpful_count, raw`.                                                        |
| ING-5 | On-demand ingestion: when a consumer asks about something that isn't in the system yet, resolve it through SerpApi, ingest it, then answer.                                                                                 |
| ING-6 | Deduplication and caching by `(source, external_id)` so the same data isn't fetched twice and the SerpApi quota isn't wasted.                                                                                               |

### AI processing (open-weight model)

| ID   | Requirement                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-1 | Serve an open-weight model (Gemma) on a Vertex AI endpoint as the primary host.                                                                                                                                                                       |
| AI-2 | Model router with the same model on DigitalOcean as the second provider: health checks, automatic failover, and per-request logging of which provider answered.                                                                                       |
| AI-3 | Per-review extraction, as JSON validated against a schema: aspects (e.g. food, service, delivery, packaging, quality, value), sentiment per aspect, atomic claims ("battery overheats after 1 hour"), and mentioned items (dishes, product variants). |
| AI-4 | Per-entity summary: strengths, weaknesses, emerging issues, and a single verdict line.                                                                                                                                                                |
| AI-5 | Batch processing with retries; a malformed model output is retried and then skipped, never allowed to crash the batch.                                                                                                                                |

### Knowledge graph

| ID   | Requirement                                                                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KG-1 | Knowledge graph in MongoDB (`nodes` and `edges` collections, `$graphLookup`); Neo4j dropped 2026-10-15.                                                                                                                                                                          |
| KG-2 | Nodes: `Entity` (Place or Product), `Platform`, `Review`, `Reviewer` (hashed), `Aspect`, `Claim`, `Item`, `Seller`, `Brand`, `Category`, `Location`.                                                                                                                             |
| KG-3 | Edges: `(Review)-[:ABOUT]->(Entity)`, `(Review)-[:ON]->(Platform)`, `(Review)-[:MENTIONS {sentiment}]->(Aspect)`, `(Review)-[:SUPPORTS]->(Claim)`, `(Claim)-[:ABOUT]->(Entity)`, `(Entity)-[:SOLD_BY]->(Seller)`, `(Entity)-[:IN]->(Category)`, `(Reviewer)-[:WROTE]->(Review)`. |
| KG-4 | Merge near-duplicate claims across reviews (by embedding similarity), so "overheats" and "gets too hot" become one claim with a support count.                                                                                                                                   |
| KG-5 | Every answer and insight traces back to the reviews behind it (shown as citations).                                                                                                                                                                                              |

### Owner advisor (U1)

| ID    | Requirement                                                                                                                   |
| ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| OWN-1 | Track an entity: add a Google Maps place or an Amazon product to a watchlist.                                                 |
| OWN-2 | Dashboard: rating trend, aspect sentiment breakdown, top claims (praise and complaints) with counts, recent negative reviews. |
| OWN-3 | Advice panel: the top 3 things to fix and the top 3 to promote, each with supporting reviews.                                 |
| OWN-4 | Competitor comparison: compare aspects against 1–3 other entities.                                                            |
| OWN-5 | Ask the advisor: a chat over the entity's graph ("Why did ratings drop last month?").                                         |

### Consumer Q&A (U2)

| ID    | Requirement                                                                                             |
| ----- | ------------------------------------------------------------------------------------------------------- |
| CON-1 | Public search page: search for a place or product, or paste a Google Maps or Amazon URL.                |
| CON-2 | Entity page: verdict, pros and cons, aspect scores, top claims with quotes.                             |
| CON-3 | Natural-language questions answered by an agent that queries the graph (GraphRAG), with cited reviews.  |
| CON-4 | Works for entities that aren't in the graph yet (see ING-5), with a "fetching reviews…" progress state. |

### Review trust signals

| ID    | Requirement                                                                               |
| ----- | ----------------------------------------------------------------------------------------- |
| TRU-1 | Burst detection: unusual spikes in review volume or rating over time.                     |
| TRU-2 | Near-duplicate review text within and across entities.                                    |
| TRU-3 | Rating and text mismatch (the model's sentiment contradicts the star rating).             |
| TRU-4 | A trust score per entity, shown to both owners and consumers, with the reasons behind it. |

### Platform and infrastructure

| ID    | Requirement                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------ |
| INF-1 | Next.js web app (owner dashboard and consumer pages) deployed on Render.                                                       |
| INF-2 | Temporal workflows for ingestion and processing, with a scheduled re-sync of watched entities.                                 |
| INF-3 | MongoDB for entities, reviews, sync state and the knowledge graph (nodes/edges, `$graphLookup`).                               |
| INF-4 | Tiger Data (Postgres): pgvector embeddings + full-text for hybrid retrieval, and TimescaleDB time series for trends and TRU-1. |
| INF-5 | Sentry error monitoring and agent tracing across the model router, extraction and Q&A.                                         |
| INF-6 | Secrets kept in environment variables only; a `.env.example` committed.                                                        |

### P0 build order

| Day                | Goal                                                                                     | Requirements                                                             |
| ------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Day 1 (Oct 14)** | Data flows end to end: SerpApi → MongoDB → model extraction → knowledge graph in MongoDB | ING-1, ING-2, ING-4, ING-6, AI-1, AI-3, AI-5, KG-1 to KG-3, INF-3, INF-6 |
| **Day 2 (Oct 15)** | Both user interfaces work                                                                | ING-3, ING-5, AI-4, KG-4, KG-5, OWN-1 to OWN-5, CON-1 to CON-4, INF-1    |
| **Day 3 (Oct 16)** | Production features and deployment                                                       | AI-2, TRU-1 to TRU-4, INF-2, INF-4, INF-5, deploy to Render              |

---

## Backlog

| ID   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BL-1 | ~~SerpApi connectors~~: out of the backlog 2026-10-15; the Google Maps plugin works against real data (`pnpm --filter @perforvisor/backend try:serpapi`).                                                                                                                                                                                                                                                                                                                                                                                                    |
| BL-2 | **Consumer live lookup** (ING-5, CON-4): answering about any place or product on demand. Moved to the backlog 2026-10-15. **Redesigned 2026-10-16 to be location-aware**: names collide worldwide, so places are resolved around the user's location (Google Maps `ll`/`location`, distance filter, a pick-one step) and products in the user's market (Amazon domain, delivery postcode). Design and test cases: `docs/PLAN-realtime-retrieval.md`, section "Consumer lookup: location-aware". The consumer app stays on built-in samples until it's built. |

## P1: days 4–5

| ID   | Requirement                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | Fine-tune a small adapter on Tinker for aspect and claim extraction; compare it against base Gemma on a labelled set of ~100 reviews. |
| P1-2 | Backboard memory for each owner (their goals, context, earlier advice) used by the advisor chat.                                      |
| P1-3 | ElevenLabs weekly audio briefing for owners.                                                                                          |
| P1-4 | Mastra as the agent framework for the owner and consumer agents. Decide on day 1 whether this moves into P0.                          |
| P1-5 | `.tech` domain pointed at Render.                                                                                                     |
| P1-6 | More SerpApi connectors (e.g. Walmart, Yelp, app stores), depending on what SerpApi supports.                                         |
| P1-7 | First real user: one local business owner uses it. Record their feedback and whether they would pay.                                  |
| P1-8 | DEV post (Side Hustle template, `#hf26challenge`), demo video, and optionally the saved agent session.                                |

## P2: after the challenge (vision)

- Official connectors: Google Business Profile API (owners' own locations) and the Amazon SP-API Customer Feedback API (brand-registered sellers).
- Marketplace trust and safety: detecting seller-level fraud and fake-product patterns across many entities, sold to marketplaces.
- Alerts (email, WhatsApp) when an emerging issue or a review burst is detected.
- Billing: paid tiers for owners; consumer use free or freemium.

## Non-functional requirements

| ID    | Requirement                                                                                                                                        |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-1 | All AI reasoning runs on open-weight models; no closed-model APIs.                                                                                 |
| NFR-2 | A consumer question about an entity already in the graph is answered in under 10 seconds; a new entity in under 60 seconds, with visible progress. |
| NFR-3 | Reviewer identities are stored only as hashes.                                                                                                     |
| NFR-4 | Model outputs are validated against a schema (Zod) before being written to any store.                                                              |
| NFR-5 | Each cloud service is behind its own module, so it can be swapped out or switched off with a flag.                                                 |

## Open questions

1. ~~Product name~~: Perforvisor.
2. How much review depth do SerpApi's Amazon engines return? Check on day 1.
3. ~~Model~~: Qwen3-0.6B for development; revisit size once extraction quality is measured.
4. Which embedding model to use for claim merging (an open-weight one, to keep NFR-1)?
5. Authentication for owners (e.g. Auth.js with Google sign-in); consumers stay anonymous.

---

## Client app status (2026-10-16)

Built and browser-tested against the local stack (sample businesses, an imported competitor, and a real Google Maps business):

| Feature                                                                                                                                                                      | Requirements        | Where                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------- |
| A. Connect a business: Google Maps (SerpApi), built-in samples, or pasted reviews; as your business or a competitor                                                          | OWN-1, ING-1, ING-3 | `#/connect`; `POST /v1/businesses`, `POST /v1/businesses/import`              |
| B. Background sync: fetch (new reviews only after the first sync) → store and embed → extract with qwen3-4b → graph → trends → report; live progress over SSE; daily re-sync | INF-2, AI-3, AI-5   | `backend/src/business/sync.ts`, worker; `GET /v1/businesses/:key/sync/events` |
| C. Per-business dashboard: overview, verdict and actions, praise and complaints, aspects; Ask the advisor on stored vectors                                                  | OWN-2, OWN-3, OWN-5 | `#/overview`, `#/ask`                                                         |
| D. Trends: rating and sentiment over time (TimescaleDB), review bursts                                                                                                       | INF-4, TRU-1        | `#/trends`; `review_events` hypertable                                        |
| E. Knowledge graph: aspect and claim nodes in MongoDB; similar claims merged (embedding similarity ≥ 0.93, or 0.86–0.93 confirmed by qwen3-4b)                               | KG-1–KG-4           | `#/insights`; `backend/src/business/graph.ts`                                 |
| F. Competitors: track rivals, side-by-side aspect scores and complaints                                                                                                      | OWN-4               | `#/competitors`                                                               |

Trust rules after testing on real Google Maps data: rating mismatch only at the extremes (5★ with negative text, 1★ with positive text); copy-paste detection ignores reviews under 5 words; every review in a copy-paste group is suspicious; claims take the sentiment of their own aspect. SerpApi calls go through a Redis cache (24 h) and a monthly budget (`SERPAPI_MONTHLY_BUDGET`, default 200).
