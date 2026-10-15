import { Card } from "@perforvisor/ui";
import { AspectBars } from "../components/AspectBars.tsx";
import { RequireReport } from "../components/Empty.tsx";
import { href } from "../lib/route.ts";

export function Overview() {
  return (
    <RequireReport>
      {({ business, report }) => {
        const { stats, summary } = report!;
        const cards = [
          { label: "Average rating", value: stats.averageRating?.toFixed(1) ?? "—", hint: business.platformRating !== undefined ? `${business.platformRating}★ on ${business.source === "google_maps" ? "Google Maps" : "the platform"}` : "from synced reviews" },
          { label: "Positive reviews", value: `${stats.analysedCount ? Math.round((stats.sentiment.positive / stats.analysedCount) * 100) : 0}%`, hint: `${stats.sentiment.negative} negative` },
          { label: "Reviews analysed", value: String(stats.analysedCount), hint: business.platformReviewCount ? `of ${business.platformReviewCount.toLocaleString()} on the platform` : `${business.storedReviews} stored` },
          { label: "Suspicious reviews", value: String(stats.suspiciousReviewIds.length), hint: "left out of the advice", link: href("trust") },
        ];
        return (
          <div className="page">
            <div className="stats">
              {cards.map((c) => (
                <Card key={c.label}>
                  <div className="stat-label">{c.label}</div>
                  <div className="stat-value">{c.link ? <a href={c.link}>{c.value}</a> : c.value}</div>
                  <div className="stat-hint">{c.hint}</div>
                </Card>
              ))}
            </div>

            {summary ? (
              <Card>
                <div className="section-label">Verdict</div>
                <p className="verdict-text">{summary.verdict}</p>
                {summary.actions.length > 0 && (
                  <>
                    <div className="section-label">Do next</div>
                    <ol className="list">
                      {summary.actions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ol>
                  </>
                )}
              </Card>
            ) : (
              <Card>
                <p className="muted">The advisor couldn't write a summary this time. The numbers below are still accurate.</p>
              </Card>
            )}

            <div className="two-col">
              <ClaimList title="Customers praise" claims={stats.praise} empty="Nothing yet." />
              <ClaimList title="Customers complain" claims={stats.complaints} empty="No complaints found." />
            </div>

            <Card>
              <div className="section-label">Aspects</div>
              <AspectBars aspects={stats.aspects} />
            </Card>
          </div>
        );
      }}
    </RequireReport>
  );
}

function ClaimList({ title, claims, empty }: { title: string; claims: { claim: string; count: number }[]; empty: string }) {
  return (
    <Card>
      <div className="section-label">{title}</div>
      {claims.length ? (
        <ul className="list">
          {claims.map((c) => (
            <li key={c.claim}>
              {c.claim} {c.count > 1 && <span className="count">×{c.count}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{empty}</p>
      )}
    </Card>
  );
}
