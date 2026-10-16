import { fetchEntries } from './api';
import type { BeerEntry, EntryPage } from './types';

export const ARCHIVE_BATCH_SIZE = 50;
export interface PublicArchive {
  schema: 'million-beers-public-archive-v1';
  revision: number;
  exportedAt: string;
  filters: Record<string, string>;
  dateBasis: string;
  completeness: 'complete';
  entries: BeerEntry[];
}
/** Explicit allowlist avoids exporting future response fields or operator-only snapshots. */
export function publicArchiveEntry(entry: BeerEntry): BeerEntry {
  const redacted =
    entry.memory?.visibility === 'private' ||
    entry.allocations.some((allocation) => allocation.contributor === 'Private member');
  const memory = redacted ? null : entry.memory;
  return {
    id: entry.id,
    totalAmount: entry.totalAmount,
    note: redacted ? null : entry.note,
    createdAt: entry.createdAt,
    localDay: entry.localDay,
    isCorrection: entry.isCorrection,
    isGroup: entry.isGroup,
    correctionOfEntryId: entry.correctionOfEntryId ?? null,
    correctionKind: entry.correctionKind ?? null,
    occurrenceSource: redacted
      ? 'unknown'
      : (entry.occurrenceSource ?? (entry.occurredAt ? 'provided' : 'unknown')),
    occurredAt: redacted ? null : (entry.occurredAt ?? null),
    occurrenceTimezone: redacted ? null : (entry.occurrenceTimezone ?? null),
    occurrencePrecision: redacted ? null : (entry.occurrencePrecision ?? null),
    allocations: entry.allocations.map(
      ({ id, contributor, amount, memberId, sourceAllocationId }) => ({
        id,
        contributor,
        amount,
        memberId: memberId ?? null,
        sourceAllocationId: sourceAllocationId ?? null,
      }),
    ),
    memory: memory
      ? {
          ...(memory.title ? { title: memory.title } : {}),
          ...(memory.shortNote ? { shortNote: memory.shortNote } : {}),
          ...(memory.venue ? { venue: memory.venue } : {}),
          ...(memory.city ? { city: memory.city } : {}),
          ...(memory.beer ? { beer: memory.beer } : {}),
          ...(memory.brewery ? { brewery: memory.brewery } : {}),
          visibility: 'public',
        }
      : null,
  };
}
export async function collectPublicArchive(
  query: string,
  signal: AbortSignal,
  progress: (records: number, batches: number) => void,
  load: (query: string, signal?: AbortSignal) => Promise<EntryPage> = fetchEntries,
): Promise<PublicArchive> {
  const source = new URLSearchParams(query);
  const params = new URLSearchParams();
  for (const key of [
    'q',
    'from',
    'to',
    'dateBasis',
    'venue',
    'brewery',
    'city',
    'memberId',
    'community',
  ]) {
    const value = source.get(key);
    if (value) params.set(key, value);
  }
  const filters = Object.fromEntries(params);
  params.set('limit', String(ARCHIVE_BATCH_SIZE));
  const entries: BeerEntry[] = [];
  const ids = new Set<string>();
  const cursors = new Set<string>();
  let revision: number | undefined;
  for (let batch = 0; ; batch++) {
    signal.throwIfAborted();
    const page = await load(params.toString(), signal);
    signal.throwIfAborted();
    if (
      !Number.isSafeInteger(page.revision) ||
      (revision !== undefined && page.revision !== revision)
    ) {
      throw new Error(
        'The archive changed or its revision could not be verified. No file was created. Start again.',
      );
    }
    revision = page.revision;
    params.set('revision', String(revision));
    for (const entry of page.entries) {
      if (ids.has(entry.id))
        throw new Error('The archive changed while loading. No file was created. Start again.');
      ids.add(entry.id);
      entries.push(publicArchiveEntry(entry));
    }
    progress(entries.length, batch + 1);
    if (!page.nextCursor) {
      break;
    }
    if (cursors.has(page.nextCursor))
      throw new Error('The archive returned a repeated page. No file was created. Try again.');
    cursors.add(page.nextCursor);
    params.set('cursor', page.nextCursor);
  }
  if (revision === undefined)
    throw new Error('The archive could not be verified. No file was created.');
  params.delete('cursor');
  params.set('limit', '1');
  const validation = await load(params.toString(), signal);
  signal.throwIfAborted();
  if (validation.revision !== revision)
    throw new Error('The archive changed before completion. No file was created. Start again.');
  return {
    schema: 'million-beers-public-archive-v1',
    revision,
    exportedAt: new Date().toISOString(),
    filters,
    dateBasis: params.get('dateBasis') === 'occurred' ? 'known occurrence date' : 'recording date',
    completeness: 'complete',
    entries,
  };
}
function csvCell(value: string | number | null | undefined): string {
  if (typeof value === 'number') return String(value);
  let text = value ?? '';
  // Strip leading controls/whitespace only for prefix detection, preserving the original text.
  let prefix = 0;
  while (prefix < text.length) {
    const code = text.charCodeAt(prefix);
    if (
      code <= 32 ||
      (code >= 127 && code <= 159) ||
      (code >= 0x200b && code <= 0x200f) ||
      /\s/u.test(text.charAt(prefix))
    )
      prefix++;
    else break;
  }
  if (/^[=+\-@]/u.test(text.slice(prefix)) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replace(/"/gu, '""')}"`;
}
export function archiveCsv(archive: PublicArchive): string {
  const headers = [
    'record_id',
    'allocation_id',
    'source_allocation_id',
    'recorded_at_utc',
    'recorded_local_day',
    'occurred_at',
    'occurrence_timezone',
    'occurrence_precision',
    'occurrence_source',
    'member_id',
    'public_display_name',
    'allocation_amount_signed',
    'entry_total_signed',
    'correction_of_record_id',
    'correction_kind',
    'note',
    'title',
    'short_note',
    'venue',
    'city',
    'beer',
    'brewery',
    'selection_date_basis',
    'archive_revision',
  ];
  const rows = archive.entries.flatMap((entry) =>
    entry.allocations.map((allocation) =>
      [
        entry.id,
        allocation.id,
        allocation.sourceAllocationId,
        new Date(entry.createdAt).toISOString(),
        entry.localDay,
        entry.occurredAt,
        entry.occurrenceTimezone,
        entry.occurrencePrecision,
        entry.occurrenceSource,
        allocation.memberId,
        allocation.contributor,
        allocation.amount,
        entry.totalAmount,
        entry.correctionOfEntryId,
        entry.correctionKind,
        entry.note,
        entry.memory?.title,
        entry.memory?.shortNote,
        entry.memory?.venue,
        entry.memory?.city,
        entry.memory?.beer,
        entry.memory?.brewery,
        archive.dateBasis,
        archive.revision,
      ]
        .map(csvCell)
        .join(','),
    ),
  );
  return '\ufeff' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
}
