import { useState, type ReactNode } from "react";
import { Card } from "@perforvisor/ui";

/** Title, optional legend, and a Chart / Table toggle: every chart has a table view. */
export function ChartCard({ title, legend, chart, table }: { title: string; legend?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <Card className="chart-card">
      <div className="chart-head">
        <div className="section-label">{title}</div>
        <div className="segmented" role="group" aria-label={`${title} view`}>
          {(["chart", "table"] as const).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {v === "chart" ? "Chart" : "Table"}
            </button>
          ))}
        </div>
      </div>
      {legend && view === "chart" && <div className="legend">{legend}</div>}
      {view === "chart" ? chart : <div className="table-wrap">{table}</div>}
    </Card>
  );
}
