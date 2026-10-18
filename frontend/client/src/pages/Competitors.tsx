import { useEffect, useState } from "react";
import type { Comparison } from "@perforvisor/core";
import { Button, Card } from "@perforvisor/ui";
import { RequireReport } from "../components/Empty.tsx";
import { SyncStatus } from "../components/SyncStatus.tsx";
import { api } from "../lib/api.ts";
import { aspectLabel, formatScore } from "../lib/format.ts";
import { href } from "../lib/route.ts";
import { useBusinesses } from "../state.tsx";

export function Competitors() {
  return (
    <RequireReport>
      {({ business, report }) => (
        <CompetitorsView
          businessKey={business.key}
          generatedAt={report!.generatedAt}
        />
      )}
    </RequireReport>
  );
}

function CompetitorsView({
  businessKey,
  generatedAt,
}: {
  businessKey: string;
  generatedAt: string;
}) {
  const { businesses, refresh } = useBusinesses();
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const competitors = (businesses ?? []).filter(
    (b) => b.role === "competitor" && b.competitorOf === businessKey,
  );
  const syncSignature = competitors
    .map((c) => `${c.key}:${c.sync.state}:${c.sync.finishedAt ?? ""}`)
    .join("|");

  useEffect(() => {
    api.compare(businessKey).then(setComparison, () => setComparison(null));
  }, [businessKey, generatedAt, syncSignature]);

  const remove = async (key: string) => {
    await api.untrack(key);
    await refresh();
  };

  const addLink = href("connect", { role: "competitor", of: businessKey });
  if (!competitors.length) {
    return (
      <div className="empty-state">
        <h2>Compare with competitors</h2>
        <p>
          Track up to a few nearby places or rival products. Perforvisor
          analyses their reviews the same way and shows where you're ahead or
          behind.
        </p>
        <a
          className="ui-button ui-button--primary ui-button--md"
          href={addLink}
        >
          Add a competitor
        </a>
      </div>
    );
  }

  const columns = comparison?.businesses ?? [];
  const aspects = [
    ...new Set(columns.flatMap((b) => Object.keys(b.aspects))),
  ].sort(
    (a, b) =>
      Math.max(...columns.map((c) => c.aspects[b]?.mentions ?? 0)) -
      Math.max(...columns.map((c) => c.aspects[a]?.mentions ?? 0)),
  );

  return (
    <div className="page">
      <div className="toolbar">
        <a
          className="ui-button ui-button--secondary ui-button--md"
          href={addLink}
        >
          Add a competitor
        </a>
      </div>

      <div className="review-list">
        {competitors.map((c) => (
          <Card key={c.key} className="competitor-row">
            <div>
              <div className="result-name">{c.name}</div>
              <SyncStatus business={c} />
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void remove(c.key)}
            >
              Remove
            </Button>
          </Card>
        ))}
      </div>

      {columns.length > 1 && (
        <Card>
          <div className="section-label">Side by side</div>
          <div className="table-wrap">
            <table className="data-table compare-table">
              <thead>
                <tr>
                  <th />
                  {columns.map((b) => (
                    <th key={b.key}>
                      {b.name}
                      {b.role === "business" && (
                        <span className="muted small"> (you)</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th>Average rating</th>
                  {columns.map((b) => (
                    <td key={b.key}>{b.averageRating?.toFixed(2) ?? "—"}</td>
                  ))}
                </tr>
                <tr>
                  <th>Reviews analysed</th>
                  {columns.map((b) => (
                    <td key={b.key}>{b.analysedReviews}</td>
                  ))}
                </tr>
                {aspects.map((aspect) => (
                  <tr key={aspect}>
                    <th>{aspectLabel(aspect)}</th>
                    {columns.map((b) => {
                      const cell = b.aspects[aspect];
                      return (
                        <td key={b.key}>
                          {cell ? (
                            <ScoreCell
                              score={cell.score}
                              mentions={cell.mentions}
                            />
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            Aspect score: share of positive minus negative mentions, from −1 to
            +1.
          </p>
        </Card>
      )}

      {columns.length > 1 && (
        <div className="two-col">
          {columns.map((b) => (
            <Card key={b.key}>
              <div className="section-label">{b.name}: top complaints</div>
              {b.topComplaints.length ? (
                <ul className="list">
                  {b.topComplaints.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">None found.</p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/** Diverging mini-bar from a zero centre line, plus the number: colour never carries meaning alone. */
function ScoreCell({ score, mentions }: { score: number; mentions: number }) {
  const width = Math.abs(score) * 50;
  return (
    <span
      className="score-cell"
      title={`${formatScore(score)} from ${mentions} mention${mentions === 1 ? "" : "s"}`}
    >
      <span className="score-track">
        <span
          className={`score-fill ${score >= 0 ? "score-fill--pos" : "score-fill--neg"}`}
          style={
            score >= 0
              ? { left: "50%", width: `${width}%` }
              : { right: "50%", width: `${width}%` }
          }
        />
      </span>
      <span className="score-num">{formatScore(score)}</span>
    </span>
  );
}
