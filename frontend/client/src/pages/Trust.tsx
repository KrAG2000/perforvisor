import { useEffect, useState } from "react";
import type { AnalysisStats, ReviewItem, Trends } from "@perforvisor/core";
import { Card } from "@perforvisor/ui";
import { RequireReport } from "../components/Empty.tsx";
import { api } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";

export function Trust() {
  return (
    <RequireReport>
      {({ business, report }) => <TrustView businessKey={business.key} generatedAt={report!.generatedAt} stats={report!.stats} />}
    </RequireReport>
  );
}

function TrustView({ businessKey, generatedAt, stats }: { businessKey: string; generatedAt: string; stats: AnalysisStats }) {
  const [reviews, setReviews] = useState<ReviewItem[] | null>(null);
  const [trends, setTrends] = useState<Trends | null>(null);
  useEffect(() => {
    api.reviews(businessKey, "suspicious").then(setReviews, () => setReviews([]));
    api.trends(businessKey).then(setTrends, () => setTrends(null));
  }, [businessKey, generatedAt]);

  const trustScore = stats.reviewCount ? Math.round(((stats.reviewCount - stats.suspiciousReviewIds.length) / stats.reviewCount) * 100) : 100;
  const bursts = trends?.bursts ?? [];

  return (
    <div className="page">
      <div className="stats">
        <Card>
          <div className="stat-label">Trust score</div>
          <div className="stat-value">{trustScore}%</div>
          <div className="stat-hint">reviews that look genuine</div>
        </Card>
        <Card>
          <div className="stat-label">Rating mismatches</div>
          <div className="stat-value">{stats.ratingMismatches.length}</div>
          <div className="stat-hint">stars contradict the text</div>
        </Card>
        <Card>
          <div className="stat-label">Copy-paste groups</div>
          <div className="stat-value">{stats.duplicateGroups.length}</div>
          <div className="stat-hint">near-identical text</div>
        </Card>
        <Card>
          <div className="stat-label">Review bursts</div>
          <div className="stat-value">{bursts.length}</div>
          <div className="stat-hint">unusual daily spikes</div>
        </Card>
      </div>
      <p className="muted">Suspicious reviews are left out of praise, complaints and advice, so they can't skew what you see.</p>

      {bursts.length > 0 && (
        <Card>
          <div className="section-label">Bursts</div>
          <ul className="list list--plain">
            {bursts.map((b) => (
              <li key={b.day}>
                <span className="badge badge--warn">{b.kind === "five_star" ? "5★ burst" : b.kind === "one_star" ? "1★ burst" : "Volume spike"}</span> {formatDate(b.day)}: {b.reviews} reviews, usually {b.typical} a day
              </li>
            ))}
          </ul>
        </Card>
      )}

      {reviews === null ? (
        <p className="muted">Loading…</p>
      ) : reviews.length === 0 ? (
        <Card>
          <p className="muted">No suspicious reviews found.</p>
        </Card>
      ) : (
        <div className="review-list">
          {reviews.map((r) => (
            <Card key={r.id}>
              <div className="review-meta">
                <span className="badges">
                  {r.flags.map((f) => (
                    <span key={f} className="badge badge--warn">{f}</span>
                  ))}
                </span>
                <span className="muted small">
                  {r.rating !== undefined && `${r.rating}★ · `}
                  {formatDate(r.createdAt)}
                </span>
              </div>
              <p>{r.text}</p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
