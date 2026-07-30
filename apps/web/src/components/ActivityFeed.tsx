import { useState } from 'react';
import { formatTimestamp, relativeTime } from '../lib/format';
import type { BeerEntry } from '../lib/types';
import { EmptyState } from './EmptyState';

function signedAmount(amount: number): string {
  return `${amount > 0 ? '+' : '−'}${Math.abs(amount)}`;
}

export function ActivityFeed({ entries, timezone }: { entries: BeerEntry[]; timezone: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggleEntry = (entryId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return (
    <section className="panel" aria-labelledby="activity-heading">
      <div className="panel__heading">
        <div>
          <p className="eyebrow">The ledger</p>
          <h2 id="activity-heading">Recent activity</h2>
        </div>
        <span>{entries.length} shown</span>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          title="The first round is waiting"
          detail="Crew updates will appear here as an append-only record."
        />
      ) : (
        <ol className="activity-list">
          {entries.map((entry) => {
            const isExpanded = expanded.has(entry.id);
            const allocationId = `allocations-${entry.id}`;
            const singleAllocation = entry.allocations[0];
            return (
              <li key={entry.id} className={entry.isGroup ? 'activity-entry--group' : ''}>
                <span
                  className={`event-amount ${entry.isCorrection ? 'event-amount--correction' : ''}`}
                >
                  {signedAmount(entry.totalAmount)}
                  <span className="sr-only"> {entry.isCorrection ? 'correction' : 'added'}</span>
                </span>
                <div className="activity-entry__body">
                  <strong>
                    {entry.isGroup
                      ? `${entry.allocations.length} people`
                      : (singleAllocation?.contributor ?? 'Anonymous')}
                  </strong>
                  {entry.isCorrection ? <span className="correction-label">Correction</span> : null}
                  {entry.note ? <p>{entry.note}</p> : null}
                  {entry.isGroup ? (
                    <>
                      <button
                        className="allocation-disclosure"
                        type="button"
                        aria-expanded={isExpanded}
                        aria-controls={allocationId}
                        onClick={() => toggleEntry(entry.id)}
                      >
                        {isExpanded ? 'Hide allocations' : 'Show allocations'}
                      </button>
                      {isExpanded ? (
                        <ul className="allocation-breakdown" id={allocationId}>
                          {entry.allocations.map((allocation) => (
                            <li key={allocation.id}>
                              <span>{allocation.contributor}</span>
                              <strong>{signedAmount(allocation.amount)}</strong>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <time
                  dateTime={new Date(entry.createdAt).toISOString()}
                  title={formatTimestamp(entry.createdAt, timezone)}
                >
                  {relativeTime(entry.createdAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
