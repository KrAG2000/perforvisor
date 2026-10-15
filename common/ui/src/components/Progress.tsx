export function Progress({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="ui-progress" role="status" aria-live="polite">
      <div className="ui-progress__track">
        <div className="ui-progress__bar" style={{ width: `${Math.max(4, Math.min(100, percent))}%` }} />
      </div>
      <span className="ui-progress__label">{label}</span>
    </div>
  );
}
