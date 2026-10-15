import { useState } from "react";
import type { TrendPoint } from "@perforvisor/core";
import { useWidth } from "./useWidth.ts";

const H = 200;
const M = { top: 12, right: 12, bottom: 26, left: 30 };

export const bucketLabel = (iso: string, bucket: "day" | "week" | "month") =>
  new Date(iso).toLocaleDateString(undefined, bucket === "month" ? { month: "short", year: "2-digit" } : { day: "numeric", month: "short" });

/** Average star rating per period: one series, 2px line, 8px markers, crosshair tooltip. */
export function RatingChart({ points, bucket }: { points: TrendPoint[]; bucket: "day" | "week" | "month" }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const rated = points.map((p, i) => ({ ...p, i })).filter((p) => p.averageRating !== null);
  const innerW = width - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const x = (i: number) => M.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (rating: number) => M.top + ((5 - rating) / 4) * innerH;
  const path = rated.map((p, k) => `${k ? "L" : "M"}${x(p.i)},${y(p.averageRating!)}`).join(" ");
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 70))));
  const active = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={H} role="img" aria-label="Average rating over time">
        {[1, 2, 3, 4, 5].map((r) => (
          <g key={r}>
            <line className="grid" x1={M.left} x2={width - M.right} y1={y(r)} y2={y(r)} />
            <text className="axis" x={M.left - 8} y={y(r)} dy="0.32em" textAnchor="end">{r}</text>
          </g>
        ))}
        {points.map((p, i) => i % labelEvery === 0 && (
          <text key={p.bucket} className="axis" x={x(i)} y={H - 6} textAnchor="middle">{bucketLabel(p.bucket, bucket)}</text>
        ))}
        {active && <line className="crosshair" x1={x(hover!)} x2={x(hover!)} y1={M.top} y2={M.top + innerH} />}
        <path className="line line--rating" d={path} />
        {rated.map((p) => (
          <circle key={p.bucket} className="marker marker--rating" cx={x(p.i)} cy={y(p.averageRating!)} r={hover === p.i ? 5 : 4} />
        ))}
        {/* Hit targets: one full-height column per period, wider than the marks. */}
        {points.map((p, i) => (
          <rect key={p.bucket} className="hit" x={x(i) - innerW / Math.max(1, points.length) / 2} y={M.top} width={innerW / Math.max(1, points.length)} height={innerH}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      {active && (
        <div className="tooltip" style={{ left: Math.min(Math.max(x(hover!), 70), width - 70), top: 0 }}>
          <strong>{bucketLabel(active.bucket, bucket)}</strong>
          <span>{active.averageRating === null ? "No ratings" : `${active.averageRating.toFixed(2)}★ average`}</span>
          <span className="muted">{active.reviews} review{active.reviews === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}
