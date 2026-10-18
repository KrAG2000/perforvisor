import { createHash } from "node:crypto";

/** Stable, non-reversible id for a reviewer, scoped to its source platform. */
export function hashIdentity(source: string, id: string): string {
  return createHash("sha256")
    .update(`${source}:${id}`)
    .digest("hex")
    .slice(0, 32);
}
