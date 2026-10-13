import { formatInteger } from '../lib/format';
import type { LeaderboardEntry } from '../lib/types';
import { EmptyState } from './EmptyState';

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId}>
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Net beers recorded</p>
          <h2 id={headingId}>Crew board</h2>
        </div>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="No standings yet"
          detail="Contributors will rank here after the first update."
        />
      ) : (
        <ol className="leaderboard">
          {entries.map((entry, index) => (
            <li key={entry.contributor}>
              <span className="rank" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <strong>{entry.contributor}</strong>
                <small>
                  {formatInteger(entry.eventCount)} {entry.eventCount === 1 ? 'update' : 'updates'}
                </small>
              </div>
              <b>
                {formatInteger(entry.netTotal)}
                <span className="sr-only"> beers</span>
              </b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
import { useId } from 'react';
