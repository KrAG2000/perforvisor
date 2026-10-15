import type { AspectStat } from "@perforvisor/core";
import { aspectLabel } from "../lib/format.ts";

const pct = (n: number, total: number) => (total ? (n / total) * 100 : 0);

/** One row per aspect: share of positive / neutral / negative mentions. */
export function AspectBars({ aspects }: { aspects: AspectStat[] }) {
  return (
    <div className="aspects">
      <div className="legend" aria-hidden>
        <span><i className="swatch swatch--pos" />Positive</span>
        <span><i className="swatch swatch--neu" />Neutral</span>
        <span><i className="swatch swatch--neg" />Negative</span>
      </div>
      {aspects.map((a) => (
        <div key={a.aspect} className="aspect-row" title={`${aspectLabel(a.aspect)}: ${a.positive} positive, ${a.neutral} neutral, ${a.negative} negative`}>
          <span className="aspect-name">{aspectLabel(a.aspect)}</span>
          <div className="stack-bar" role="img" aria-label={`${a.positive} positive, ${a.neutral} neutral, ${a.negative} negative mentions`}>
            {a.positive > 0 && <span className="seg seg--pos" style={{ width: `${pct(a.positive, a.mentions)}%` }} />}
            {a.neutral > 0 && <span className="seg seg--neu" style={{ width: `${pct(a.neutral, a.mentions)}%` }} />}
            {a.negative > 0 && <span className="seg seg--neg" style={{ width: `${pct(a.negative, a.mentions)}%` }} />}
          </div>
          <span className="aspect-count">{a.mentions}</span>
        </div>
      ))}
    </div>
  );
}
