import { formatInteger, formatPercent } from '../lib/format';

interface Props {
  total: number;
  target: number;
  remaining: number;
  percent: number;
}

export function ProgressDisplay({ total, target, remaining, percent }: Props) {
  return (
    <section className="hero" aria-labelledby="progress-heading">
      <p className="hero__kicker">Collective total</p>
      <h2 id="progress-heading" className="hero__total" aria-live="polite">
        {formatInteger(total)}
      </h2>
      <p className="hero__target">of {formatInteger(target)} beers</p>
      <progress
        className="progress-track"
        value={Math.min(total, target)}
        max={target}
        aria-label={`${formatPercent(percent)} complete`}
      />
      <div className="hero__meta">
        <strong>{formatPercent(percent)} complete</strong>
        <span>{formatInteger(remaining)} remaining</span>
      </div>
    </section>
  );
}
