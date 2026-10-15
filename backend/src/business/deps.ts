import type { Config } from "../config.ts";
import type { Mongo } from "../db/mongo.ts";
import type { Postgres } from "../db/postgres.ts";
import type { Connectors } from "../plugins/loader.ts";
import { createAdvisor } from "../ai/advise.ts";
import { createExtractor } from "../ai/extract.ts";
import { createGraphBuilder } from "./graph.ts";
import type { SyncDeps } from "./sync.ts";

export function createSyncDeps(config: Config, stores: { mongo: Mongo; pg: Postgres }, connectors: Connectors): SyncDeps {
  return { config, stores, connectors, extract: createExtractor(config), advise: createAdvisor(config), graph: createGraphBuilder(config, stores) };
}
