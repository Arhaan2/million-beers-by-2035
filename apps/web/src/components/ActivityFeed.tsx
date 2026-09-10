import { useId, useState } from 'react';
import { formatTimestamp, relativeTime } from '../lib/format';
import type { BeerEntry } from '../lib/types';
import { EmptyState } from './EmptyState';

function signedAmount(amount: number): string {
  return `${amount > 0 ? '+' : '−'}${Math.abs(amount)}`;
}

export function ActivityFeed({
  entries,
  timezone,
  title = 'Recent activity',
}: {
  entries: BeerEntry[];
  timezone: string;
  title?: string;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const feedId = useId();

  const toggleEntry = (entryId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(entryId)) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  };

  return (
    <section className="panel" aria-labelledby={`${feedId}-heading`}>
      <div className="panel__heading">
        <div>
          <p className="eyebrow">The ledger</p>
          <h2 id={`${feedId}-heading`}>{title}</h2>
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
            const allocationId = `${feedId}-allocations-${entry.id}`;
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
                    {entry.memory?.title ??
                      (entry.isGroup
                        ? `${entry.allocations.length} people`
                        : (singleAllocation?.contributor ?? 'Anonymous'))}
                  </strong>
                  {entry.isCorrection ? (
                    <span className="correction-label">
                      {entry.correctionKind === 'linked'
                        ? 'Linked correction'
                        : 'Legacy adjustment'}
                    </span>
                  ) : null}
                  {entry.isSystem ? (
                    <span className="correction-label">Operational record</span>
                  ) : null}
                  {entry.note ? <p>{entry.note}</p> : null}
                  {entry.memory?.venue ? (
                    <p>
                      {entry.memory.venue}
                      {entry.memory.city ? ` · ${entry.memory.city}` : ''}
                    </p>
                  ) : null}
                  <a className="entry-detail-link" href={`#/entry/${encodeURIComponent(entry.id)}`}>
                    View record <span aria-hidden="true">↗</span>
                  </a>
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
