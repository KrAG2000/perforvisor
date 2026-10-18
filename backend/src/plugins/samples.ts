import type { Connector, Entity, PluginManifest } from "@perforvisor/core";
import { samples } from "../samples.ts";
import type { LoadedConnector } from "./loader.ts";

const SOURCE = "sample";

/** Built-in demo businesses, served through the connector interface like any platform. Free. */
export function sampleConnector(): LoadedConnector {
  const manifest: PluginManifest = {
    id: "samples",
    name: "Sample data",
    kind: "connector",
    source: SOURCE,
  };
  const toEntity = (s: (typeof samples)[number]): Entity => ({
    ref: { source: SOURCE, externalId: s.id },
    kind: s.kind,
    name: s.entityName,
    category: s.category,
    reviewCount: s.reviews.length,
  });
  const find = (id: string) => {
    const sample = samples.find((s) => s.id === id);
    if (!sample) throw new Error(`No sample "${id}"`);
    return sample;
  };

  const connector: Connector = {
    async search(query) {
      const q = query.toLowerCase();
      const matches = samples.filter((s) =>
        `${s.entityName} ${s.category}`.toLowerCase().includes(q),
      );
      return (matches.length ? matches : samples).map(toEntity);
    },
    async getEntity(ref) {
      return toEntity(find(ref.externalId));
    },
    async fetchReviews(ref, options = {}) {
      const sample = find(ref.externalId);
      const reviews = sample.reviews
        .filter(
          (r) =>
            !options.since ||
            !r.createdAt ||
            new Date(r.createdAt) > options.since,
        )
        .map((r) => ({
          source: SOURCE,
          externalId: r.id,
          entity: ref,
          rating: r.rating ?? null,
          text: r.text,
          createdAt: r.createdAt ?? new Date().toISOString(),
        }));
      return { reviews };
    },
  };
  return { manifest, connector };
}
