import { formatInteger, formatPercent } from '../lib/format';

interface Props {
  total: number;
  target: number;
  remaining: number;
  percent: number;
}

export function ProgressDisplay({ total, target, remaining, percent }: Props) {
  const headingId = useId();
  const displayTotal = formatInteger(total);
  return (
    <section className="hero" aria-labelledby={headingId}>
      <p id={headingId} className="hero__kicker">
        Collective total
      </p>
      <h2
        id="progress-heading"
        className={`hero__total${displayTotal.length > 6 ? ' hero__total--long' : ''}`}
        data-digits={displayTotal.length}
        aria-live="polite"
        aria-atomic="true"
      >
        {displayTotal}
      </h2>
      <p className="hero__target">of {formatInteger(target)} beers</p>
      <progress
        className="progress-track"
        value={Math.max(0, Math.min(total, target))}
        max={target}
        aria-label="Progress toward the collective goal"
        aria-valuetext={`${formatInteger(total)} of ${formatInteger(target)} beers, ${formatPercent(percent)} complete`}
      />
      <div className="hero__meta">
        <strong>{formatPercent(percent)} complete</strong>
        <span>{formatInteger(remaining)} remaining</span>
      </div>
    </section>
  );
}
import { useId } from 'react';
