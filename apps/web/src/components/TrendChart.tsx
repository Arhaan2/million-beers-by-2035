import type { DailyTotal } from '../lib/types';

export function TrendChart({ days }: { days: DailyTotal[] }) {
  const values = days.map((day) => day.netTotal);
  const maximum = Math.max(1, ...values.map(Math.abs));
  const width = 600;
  const height = 180;
  const baseline = height / 2;
  const step = days.length > 1 ? width / (days.length - 1) : width;
  const points = values
    .map((value, index) => `${index * step},${baseline - (value / maximum) * 72}`)
    .join(' ');
  const net = values.reduce((sum, value) => sum + value, 0);
  const active = days.filter((day) => day.eventCount > 0).length;
  return (
    <section className="panel panel--trend" aria-labelledby="trend-heading">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Last 30 local days</p>
          <h2 id="trend-heading">Activity signal</h2>
        </div>
        <span>{active} active days</span>
      </div>
      <div className="chart-wrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby="chart-title chart-desc"
          preserveAspectRatio="none"
        >
          <title id="chart-title">Net beer activity over the last 30 days</title>
          <desc id="chart-desc">
            {active} active days with a net change of {net} beers.
          </desc>
          <line x1="0" y1={baseline} x2={width} y2={baseline} className="chart-baseline" />
          <polyline points={points || `0,${baseline}`} className="chart-line" />
          {values.map((value, index) => (
            <circle
              key={days[index]?.localDay ?? index}
              cx={index * step}
              cy={baseline - (value / maximum) * 72}
              r="3"
              className="chart-point"
            />
          ))}
        </svg>
      </div>
      <p className="chart-summary">
        Net change across this window:{' '}
        <strong>
          {net >= 0 ? '+' : ''}
          {net}
        </strong>
        . Corrections appear below the center line.
      </p>
    </section>
  );
}
