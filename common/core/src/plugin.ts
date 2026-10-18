import type { z } from "zod";
import type { Entity, EntityRef } from "./schemas/entity.ts";
import type { ReviewPage } from "./schemas/review.ts";

export type PluginKind = "connector";

export interface PluginManifest {
  /** Matches the plugin's folder name under plugins/ and the id used in the PLUGINS env var. */
  id: string;
  name: string;
  kind: PluginKind;
  /** Source key written onto every entity and review this plugin produces. */
  source: string;
}

export interface PluginContext {
  log: {
    debug(obj: object | string, msg?: string): void;
    info(obj: object | string, msg?: string): void;
    warn(obj: object | string, msg?: string): void;
    error(obj: object | string, msg?: string): void;
  };
  fetch: typeof fetch;
}

export interface FetchReviewsOptions {
  cursor?: string;
  /** Stop once reviews are older than this. */
  since?: Date;
}

/** A connector pulls entities and their reviews from one platform. */
export interface Connector {
  /** Find entities matching a free-text query or a URL on the platform. */
  search(query: string): Promise<Entity[]>;
  getEntity(ref: EntityRef): Promise<Entity>;
  fetchReviews(
    ref: EntityRef,
    options?: FetchReviewsOptions,
  ): Promise<ReviewPage>;
}

export interface ConnectorPlugin<Config = unknown> {
  manifest: PluginManifest & { kind: "connector" };
  /** Validates the plugin's settings, read from environment variables. */
  configSchema: z.ZodType<Config>;
  create(config: Config, ctx: PluginContext): Connector;
}

export type Plugin = ConnectorPlugin<any>;

/** Identity helper that gives plugin authors type inference for their config. */
export function defineConnector<Config>(
  plugin: ConnectorPlugin<Config>,
): ConnectorPlugin<Config> {
  return plugin;
}
