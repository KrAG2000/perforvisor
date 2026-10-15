import { useEffect, useState } from "react";
import type { KnowledgeGraph } from "@perforvisor/core";
import { Card } from "@perforvisor/ui";
import { RequireReport } from "../components/Empty.tsx";
import { api } from "../lib/api.ts";
import { aspectLabel, formatDate, formatScore } from "../lib/format.ts";

export function Insights() {
  return <RequireReport>{({ business, report }) => <InsightsView businessKey={business.key} generatedAt={report!.generatedAt} />}</RequireReport>;
}

function InsightsView({ businessKey, generatedAt }: { businessKey: string; generatedAt: string }) {
  const [graph, setGraph] = useState<KnowledgeGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.graph(businessKey).then(setGraph, (e) => setError(e.message));
  }, [businessKey, generatedAt]);

  if (error) return <p className="ui-error">{error}</p>;
  if (!graph) return <p className="muted">Loading…</p>;

  return (
    <div className="page">
      <p className="muted">
        What customers say, grouped by topic. Claims that mean the same thing are merged across reviews, so counts show how many customers raise each point.
        Suspicious reviews are left out. Knowledge graph: {graph.nodes} nodes, {graph.edges} links.
      </p>
      {graph.aspects.map((a) => (
        <Card key={a.aspect}>
          <div className="insight-head">
            <h3>{aspectLabel(a.aspect)}</h3>
            <span className={`score ${a.score > 0 ? "score--pos" : a.score < 0 ? "score--neg" : ""}`}>{formatScore(a.score)}</span>
            <span className="muted small">{a.mentions} mention{a.mentions === 1 ? "" : "s"}</span>
          </div>
          <ul className="claims">
            {a.claims.map((c) => (
              <li key={c.id}>
                <i className={`swatch swatch--${c.sentiment === "positive" ? "pos" : c.sentiment === "negative" ? "neg" : "neu"}`} aria-label={c.sentiment} />
                <div className="claim-body">
                  <div>
                    {c.text} {c.count > 1 && <span className="count">×{c.count}</span>}
                  </div>
                  {c.variants.length > 0 && <div className="muted small">Also said as: {c.variants.map((v) => `“${v}”`).join(", ")}</div>}
                  {c.lastSeen && (
                    <div className="muted small">
                      {c.count > 1 && c.firstSeen !== c.lastSeen ? `${formatDate(c.firstSeen)} – ${formatDate(c.lastSeen)}` : formatDate(c.lastSeen)}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
