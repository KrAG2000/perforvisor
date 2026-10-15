import { useState } from "react";
import type { TrendPoint } from "@perforvisor/core";
import { bucketLabel } from "./RatingChart.tsx";
import { useWidth } from "./useWidth.ts";

const H = 200;
const M = { top: 12, right: 12, bottom: 26, left: 30 };
const GAP = 2;

const keys = ["positive", "neutral", "negative"] as const;

/** Reviews per period, stacked by sentiment (diverging: blue / gray / red), 2px gaps, rounded tops. */
export function SentimentChart({ points, bucket }: { points: TrendPoint[]; bucket: "day" | "week" | "month" }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = width - M.left - M.right;
  const innerH = H - M.top - M.bottom;
  const max = Math.max(1, ...points.map((p) => p.reviews));
  const ticks = niceTicks(max);
  const top = ticks.at(-1)!;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(4, Math.min(28, slot * 0.6));
  const y = (v: number) => M.top + innerH - (v / top) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 70))));
  const active = hover !== null ? points[hover] : null;

  return (
    <div ref={ref} className="chart">
      <svg width={width} height={H} role="img" aria-label="Reviews per period by sentiment">
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>
          </g>
        ))}
        {points.map((p, i) => {
          const cx = M.left + slot * i + slot / 2;
          // Analysed reviews split by sentiment; reviews not yet analysed are not drawn.
          let base = 0;
          const segments = keys.filter((k) => p[k] > 0).map((k) => {
            const seg = { k, from: base, to: base + p[k] };
            base += p[k];
            return seg;
          });
          return (
            <g key={p.bucket} opacity={hover === null || hover === i ? 1 : 0.55}>
              {segments.map((s, n) => {
                const y0 = y(s.from) - (n > 0 ? GAP / 2 : 0);
                const y1 = y(s.to) + (n < segments.length - 1 ? GAP / 2 : 0);
                const h = Math.max(1, y0 - y1);
                const isTop = n === segments.length - 1;
                return isTop ? (
                  <path key={s.k} className={`bar bar--${s.k}`} d={roundedTop(cx - barW / 2, y1, barW, h, Math.min(4, h, barW / 2))} />
                ) : (
                  <rect key={s.k} className={`bar bar--${s.k}`} x={cx - barW / 2} y={y1} width={barW} height={h} />
                );
              })}
              {i % labelEvery === 0 && <text className="axis" x={cx} y={H - 6} textAnchor="middle">{bucketLabel(p.bucket, bucket)}</text>}
              <rect className="hit" x={cx - slot / 2} y={M.top} width={slot} height={innerH} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="tooltip" style={{ left: Math.min(Math.max(M.left + slot * hover! + slot / 2, 80), width - 80), top: 0 }}>
          <strong>{bucketLabel(active.bucket, bucket)}</strong>
          <span>{active.reviews} review{active.reviews === 1 ? "" : "s"}</span>
          <span><i className="swatch swatch--pos" />{active.positive} positive</span>
          <span><i className="swatch swatch--neu" />{active.neutral} neutral</span>
          <span><i className="swatch swatch--neg" />{active.negative} negative</span>
        </div>
      )}
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : Math.ceil(max / 5 / 10) * 10;
  const ticks = [];
  for (let t = 0; t <= max + step - 1; t += step) ticks.push(t);
  return ticks.length > 1 ? ticks : [0, step];
}

/** Rect with the two top corners rounded: the data end is rounded, the base stays square. */
function roundedTop(x: number, y: number, w: number, h: number, r: number) {
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
