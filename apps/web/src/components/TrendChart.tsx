import { useId } from 'react';
import { formatInteger } from '../lib/format';
import type { DailyTotal } from '../lib/types';
import { EmptyState } from './EmptyState';

function formatDay(localDay: string, full = false): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    ...(full ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  }).format(new Date(`${localDay}T12:00:00Z`));
}

function signedTotal(value: number): string {
  return `${value > 0 ? '+' : ''}${formatInteger(value)}`;
}

export function TrendChart({ days }: { days: DailyTotal[] }) {
  const chartId = useId();
  const values = days.map((day) => day.netTotal);
  const maximum = Math.max(1, ...values.map(Math.abs));
  const width = 600;
  const height = 180;
  const baseline = height / 2;
  const padding = 5;
  const step = days.length > 1 ? (width - padding * 2) / (days.length - 1) : 0;
  const x = (index: number) => (days.length === 1 ? width / 2 : padding + index * step);
  const points = values
    .map((value, index) => `${x(index)},${baseline - (value / maximum) * 72}`)
    .join(' ');
  const net = values.reduce((sum, value) => sum + value, 0);
  const active = days.filter((day) => day.eventCount > 0).length;
  const firstDay = days[0]?.localDay;
  const lastDay = days.at(-1)?.localDay;

  return (
    <section className="panel panel--trend" aria-labelledby={`${chartId}-heading`}>
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Recorded activity · daily net totals</p>
          <h2 id={`${chartId}-heading`}>The recorded trend</h2>
        </div>
        <span>
          {active} {active === 1 ? 'day' : 'days'} with records
        </span>
      </div>
      {active === 0 ? (
        <EmptyState
          title="A quiet stretch on the board"
          detail="No updates were recorded in this window. New records will start the trend here."
        />
      ) : (
        <>
          <div className="chart-layout">
            <div className="chart-scale" aria-hidden="true">
              <span>+{formatInteger(maximum)}</span>
              <span>0</span>
              <span>−{formatInteger(maximum)}</span>
            </div>
            <div className="chart-wrap">
              <svg
                viewBox={`0 0 ${width} ${height}`}
                role="img"
                aria-labelledby={`${chartId}-title ${chartId}-desc`}
                preserveAspectRatio="none"
              >
                <title id={`${chartId}-title`}>Daily net beer activity</title>
                <desc id={`${chartId}-desc`}>
                  {firstDay && lastDay
                    ? `${formatDay(firstDay, true)} to ${formatDay(lastDay, true)}. `
                    : ''}
                  {active} {active === 1 ? 'day' : 'days'} with records and a net change of{' '}
                  {signedTotal(net)} beers. Expand daily totals below for each date and value.
                </desc>
                <line x1="0" y1={baseline} x2={width} y2={baseline} className="chart-baseline" />
                <polyline points={points} className="chart-line" />
                {values.map((value, index) => (
                  <circle
                    key={days[index]?.localDay ?? index}
                    cx={x(index)}
                    cy={baseline - (value / maximum) * 72}
                    r="3"
                    className="chart-point"
                  />
                ))}
              </svg>
            </div>
          </div>
          {firstDay && lastDay ? (
            <div className="chart-dates" aria-hidden="true">
              <span>{formatDay(firstDay)}</span>
              <span>{formatDay(lastDay)}</span>
            </div>
          ) : null}
          <p className="chart-summary">
            Net change in this window: <strong>{signedTotal(net)} beers</strong>. Days with a
            negative net change fall below zero.
          </p>
          <details className="chart-data">
            <summary>View daily totals</summary>
            <div
              className="chart-data__scroll"
              role="region"
              aria-label="Daily totals"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">Beer activity by recorded date</caption>
                <thead>
                  <tr>
                    <th scope="col">Recorded date</th>
                    <th scope="col">Net beers</th>
                    <th scope="col">Updates</th>
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={day.localDay}>
                      <th scope="row">
                        <time dateTime={day.localDay}>{formatDay(day.localDay, true)}</time>
                      </th>
                      <td>{signedTotal(day.netTotal)}</td>
                      <td>{formatInteger(day.eventCount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
