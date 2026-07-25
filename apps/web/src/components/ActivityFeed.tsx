import { formatTimestamp, relativeTime } from '../lib/format';
import type { BeerEvent } from '../lib/types';
import { EmptyState } from './EmptyState';

export function ActivityFeed({ events, timezone }: { events: BeerEvent[]; timezone: string }) {
  return (
    <section className="panel" aria-labelledby="activity-heading">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">The ledger</p>
          <h2 id="activity-heading">Recent activity</h2>
        </div>
        <span>{events.length} shown</span>
      </div>
      {events.length === 0 ? (
        <EmptyState
          title="The first round is waiting"
          detail="Crew updates will appear here as an append-only record."
        />
      ) : (
        <ol className="activity-list">
          {events.map((event) => (
            <li key={event.id}>
              <span
                className={`event-amount ${event.amount < 0 ? 'event-amount--correction' : ''}`}
              >
                {event.amount > 0 ? '+' : '−'}
                {Math.abs(event.amount)}
                <span className="sr-only"> {event.amount > 0 ? 'added' : 'correction'}</span>
              </span>
              <div>
                <strong>{event.contributor}</strong>
                {event.note ? <p>{event.note}</p> : null}
              </div>
              <time
                dateTime={new Date(event.createdAt).toISOString()}
                title={formatTimestamp(event.createdAt, timezone)}
              >
                {relativeTime(event.createdAt)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
