import type { ReactNode } from "react";
import { href } from "../lib/route.ts";
import { useBusinesses } from "../state.tsx";

/** Shown when no business is connected yet, or the selected one has no report. */
export function RequireReport({ children }: { children: (detail: NonNullable<ReturnType<typeof useBusinesses>["detail"]>) => ReactNode }) {
  const { businesses, detail, error } = useBusinesses();
  if (error) return <p className="ui-error">{error}</p>;
  if (!businesses) return <p className="muted">Loading…</p>;
  if (!detail) {
    return (
      <div className="empty-state">
        <h2>Connect your business</h2>
        <p>Find it on Google Maps, try a sample, or paste reviews from any platform. Perforvisor reads every review and tells you what to fix first.</p>
        <a className="ui-button ui-button--primary ui-button--md" href={href("connect")}>
          Connect a business
        </a>
      </div>
    );
  }
  if (!detail.report) {
    return <p className="muted">The first sync is still running. Results appear here as soon as it finishes.</p>;
  }
  return <>{children(detail)}</>;
}
