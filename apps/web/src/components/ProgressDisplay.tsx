import { useId } from 'react';
import { formatInteger, formatPercent } from '../lib/format';

interface Props {
  total: number;
  target: number;
  remaining: number;
  percent: number;
}

export function ProgressDisplay({ total, target, remaining, percent }: Props) {
  const headingId = useId();
  return (
    <section className="count-column" aria-labelledby={headingId}>
      <p id={headingId} className="tally-label">
        Collective total
      </p>
      <div className="tally-total">
        <h2 id="progress-heading" aria-live="polite" aria-atomic="true">
          {formatInteger(total)}
        </h2>
        <span>of {formatInteger(target)} beers</span>
      </div>
      <progress
        className="ledger-progress"
        value={Math.max(0, Math.min(total, target))}
        max={target}
        aria-label="Progress toward the collective goal"
        aria-valuetext={`${formatInteger(total)} of ${formatInteger(target)} beers, ${formatPercent(percent)} complete`}
      />
      <div className="tally-caption">
        <span>{formatPercent(percent)} complete</span>
        <span>{formatInteger(remaining)} remaining</span>
      </div>
    </section>
  );
}
