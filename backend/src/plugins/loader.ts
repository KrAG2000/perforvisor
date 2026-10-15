import { z } from "zod";
import type { Connector, PluginContext, PluginManifest } from "@perforvisor/core";
import { pluginRegistry } from "./registry.ts";
import { sampleConnector } from "./samples.ts";

export interface LoadedConnector {
  manifest: PluginManifest;
  connector: Connector;
}

/** Connectors keyed by source (e.g. "google_maps"). */
export type Connectors = Map<string, LoadedConnector>;

/**
 * Loads connector plugins. With an explicit PLUGINS list, every listed plugin must be
 * configured. With PLUGINS empty, every plugin whose settings are present is loaded and
 * the rest are skipped. The built-in sample connector is always available.
 */
export async function loadPlugins(ids: string[], ctx: PluginContext, env: NodeJS.ProcessEnv = process.env): Promise<Connectors> {
  const connectors: Connectors = new Map();
  const samples = sampleConnector();
  connectors.set(samples.manifest.source, samples);

  const explicit = ids.length > 0;
  for (const id of explicit ? ids : Object.keys(pluginRegistry)) {
    const load = pluginRegistry[id];
    if (!load) {
      throw new Error(`Unknown plugin "${id}". Known plugins: ${Object.keys(pluginRegistry).join(", ")}`);
    }
    const { default: plugin } = await load();

    const config = plugin.configSchema.safeParse(env);
    if (!config.success) {
      if (explicit) throw new Error(`Plugin "${id}" is misconfigured:\n${z.prettifyError(config.error)}`);
      ctx.log.info({ plugin: id }, "plugin skipped: settings not present");
      continue;
    }

    connectors.set(plugin.manifest.source, { manifest: plugin.manifest, connector: plugin.create(config.data, ctx) });
    ctx.log.info({ plugin: id, source: plugin.manifest.source }, "plugin loaded");
  }

  return connectors;
}
