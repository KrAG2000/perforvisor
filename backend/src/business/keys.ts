import type { EntityRef } from "@perforvisor/core";

export const entityKeyOf = (ref: EntityRef) => `${ref.source}:${ref.externalId}`;

/** Source used for reviews the owner imports (paste or CSV); no connector fetches them. */
export const IMPORT_SOURCE = "import";
