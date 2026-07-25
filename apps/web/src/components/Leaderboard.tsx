import { formatInteger } from '../lib/format';
import type { LeaderboardEntry } from '../lib/types';
import { EmptyState } from './EmptyState';

export function Leaderboard({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <section className="panel" aria-labelledby="leaderboard-heading">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">Net recorded</p>
          <h2 id="leaderboard-heading">Crew board</h2>
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
              <span className="rank">{String(index + 1).padStart(2, '0')}</span>
              <div>
                <strong>{entry.contributor}</strong>
                <small>{formatInteger(entry.eventCount)} updates</small>
              </div>
              <b>{formatInteger(entry.netTotal)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
