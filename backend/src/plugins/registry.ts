import type { Plugin } from "@perforvisor/core";

/**
 * Every plugin the backend can load, keyed by its folder name under plugins/.
 * Imports are lazy, so only plugins listed in PLUGINS are loaded at runtime.
 * Adding a plugin: create plugins/<id>, add it to backend's dependencies, add one line here.
 */
export const pluginRegistry: Record<string, () => Promise<{ default: Plugin }>> = {
  "serpapi-google-maps": () => import("@perforvisor/plugin-serpapi-google-maps"),
};
