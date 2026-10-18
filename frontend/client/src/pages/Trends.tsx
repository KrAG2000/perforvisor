import { useEffect, useState } from "react";
import type { Trends as TrendsData } from "@perforvisor/core";
import { Card } from "@perforvisor/ui";
import { ChartCard } from "../charts/ChartCard.tsx";
import { bucketLabel, RatingChart } from "../charts/RatingChart.tsx";
import { SentimentChart } from "../charts/SentimentChart.tsx";
import { RequireReport } from "../components/Empty.tsx";
import { api } from "../lib/api.ts";
import { formatDate } from "../lib/format.ts";

export function Trends() {
  return (
    <RequireReport>
      {({ business, report }) => (
        <TrendsView
          businessKey={business.key}
          generatedAt={report!.generatedAt}
        />
      )}
    </RequireReport>
  );
}

const burstLabel = {
  five_star: "Burst of 5★ reviews",
  one_star: "Burst of 1★ reviews",
  volume: "Unusual review volume",
};

function TrendsView({
  businessKey,
  generatedAt,
}: {
  businessKey: string;
  generatedAt: string;
}) {
  const [trends, setTrends] = useState<TrendsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.trends(businessKey).then(setTrends, (e) => setError(e.message));
  }, [businessKey, generatedAt]);

  if (error) return <p className="ui-error">{error}</p>;
  if (!trends) return <p className="muted">Loading…</p>;
  if (!trends.range) return <p className="muted">No dated reviews yet.</p>;
  const { points, bucket, bursts, range } = trends;
  const spanDays =
    (new Date(range.to).getTime() - new Date(range.from).getTime()) /
    86_400_000;

  const table = (
    <table className="data-table">
      <thead>
        <tr>
          <th>
            {bucket === "day" ? "Day" : bucket === "week" ? "Week of" : "Month"}
          </th>
          <th>Reviews</th>
          <th>Avg rating</th>
          <th>Positive</th>
          <th>Neutral</th>
          <th>Negative</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p) => (
          <tr key={p.bucket}>
            <td>{bucketLabel(p.bucket, bucket)}</td>
            <td>{p.reviews}</td>
            <td>{p.averageRating?.toFixed(2) ?? "—"}</td>
            <td>{p.positive}</td>
            <td>{p.neutral}</td>
            <td>{p.negative}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <div className="page">
      <p className="muted">
        {points.reduce((n, p) => n + p.reviews, 0)} synced reviews from{" "}
        {formatDate(range.from)} to {formatDate(range.to)}, grouped by {bucket}.
        {spanDays < 14 &&
          " Busy places get many reviews a day, so the first sync covers a short span; daily re-syncs extend it."}
      </p>
      <ChartCard
        title="Average rating"
        chart={<RatingChart points={points} bucket={bucket} />}
        table={table}
      />
      <ChartCard
        title="Reviews by sentiment"
        legend={
          <>
            <span>
              <i className="swatch swatch--pos" />
              Positive
            </span>
            <span>
              <i className="swatch swatch--neu" />
              Neutral
            </span>
            <span>
              <i className="swatch swatch--neg" />
              Negative
            </span>
          </>
        }
        chart={<SentimentChart points={points} bucket={bucket} />}
        table={table}
      />
      <Card>
        <div className="section-label">Review bursts</div>
        {bursts.length === 0 ? (
          <p className="muted">
            No unusual spikes. A burst is a day with at least 3 reviews and 3×
            the usual daily volume.
          </p>
        ) : (
          <ul className="list list--plain">
            {bursts.map((b) => (
              <li key={b.day}>
                <span
                  className={`badge ${b.kind === "volume" ? "" : "badge--warn"}`}
                >
                  {burstLabel[b.kind]}
                </span>{" "}
                {formatDate(b.day)}: {b.reviews} reviews (usually {b.typical} a
                day)
                {b.averageRating !== null &&
                  `, averaging ${b.averageRating.toFixed(1)}★`}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
