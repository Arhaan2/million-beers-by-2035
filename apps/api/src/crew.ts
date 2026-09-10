import { ApiError } from './responses';
import { normalizeContributor, normalizeContributorKey, parseMemory } from './schemas';
import type { MemoryInput, PublicEntry } from './types';

export type Database = D1Database | D1DatabaseSession;
export interface UpgradeState {
  revision: number;
  mutations_enabled: number;
  schema_version: number;
}
export async function readUpgrade(database: Database): Promise<UpgradeState> {
  const state = await database
    .prepare('SELECT revision, mutations_enabled, schema_version FROM upgrade_state WHERE id = 1')
    .first<UpgradeState>();
  if (!state) throw new ApiError(503, 'The upgraded database is not ready.', 'schema_not_ready');
  return state;
}
export function capabilities(state: UpgradeState) {
  return {
    crew: true,
    history: true,
    memories: true,
    occurrence: Boolean(state.mutations_enabled),
    linkedCorrections: Boolean(state.mutations_enabled),
    metadataEditing: Boolean(state.mutations_enabled),
    memberCreation: Boolean(state.mutations_enabled),
    enhancedLogging: Boolean(state.mutations_enabled),
    photos: false,
    strongIdentity: false,
  };
}
export async function requireUpgradeWrites(database: Database): Promise<void> {
  if (!(await readUpgrade(database)).mutations_enabled)
    throw new ApiError(
      503,
      'Enhanced entry features are temporarily unavailable. Existing entry recording remains available.',
      'feature_disabled',
    );
}
export async function readiness(env: Env) {
  try {
    const database = env.DB.withSession('first-primary');
    const checks = await database.batch<Record<string, unknown>>([
      database.prepare(
        'SELECT revision, mutations_enabled, schema_version FROM upgrade_state WHERE id = 1',
      ),
      database.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name IN ('crew_revision_entry', 'crew_member_bridge', 'crew_correction_parent', 'crew_correction_allocation', 'operator_member_apply', 'operator_classification_apply', 'operator_capabilities_apply', 'crew_metadata_write_gate', 'crew_projection_write_gate')",
      ),
      database.prepare('SELECT total, entry_count, event_count FROM challenge_state WHERE id = 1'),
      database.prepare('SELECT COUNT(*) AS count FROM entry_metadata WHERE 0'),
    ]);
    const state = checks[0]?.results[0] as UpgradeState | undefined;
    const count = checks[1]?.results[0]?.count;
    if (!state || state.schema_version !== 3 || count !== 9 || !checks[2]?.results[0])
      throw new Error('schema incomplete');
    const version = (
      env as Env & { VERSION_METADATA?: { id: string; tag: string; timestamp: string } }
    ).VERSION_METADATA;
    return {
      ok: true as const,
      service: 'million-beers-api',
      release: version?.tag || version?.id || 'local-development',
      schemaVersion: state.schema_version,
      revision: state.revision,
      capabilities: capabilities(state),
    };
  } catch {
    return {
      ok: false as const,
      service: 'million-beers-api',
      release: 'unavailable',
      schemaVersion: null,
      capabilities: {
        crew: false,
        history: false,
        memories: false,
        occurrence: false,
        linkedCorrections: false,
        metadataEditing: false,
        memberCreation: false,
        enhancedLogging: false,
        photos: false,
        strongIdentity: false,
      },
    };
  }
}

// The same predicate protects public metadata in legacy and new endpoints.
export const publicTextCondition = `coalesce(m.visibility, 'public') = 'public' AND NOT EXISTS (
  SELECT 1 FROM allocation_members privacy_am JOIN crew_members privacy_m ON privacy_m.id = privacy_am.member_id
  WHERE privacy_am.entry_id = e.id AND privacy_m.public_display = 0)`;

interface PublicEntryRow {
  [key: string]: unknown;
  id: string;
  total_amount: number;
  note: string | null;
  created_at: number;
  local_day: string;
  allocation_count: number;
  occurred_at: number | null;
  occurrence_timezone: string | null;
  occurrence_precision: 'day' | 'minute' | null;
  title: string | null;
  short_note: string | null;
  venue: string | null;
  city: string | null;
  beer: string | null;
  brewery: string | null;
  text_public: number;
  metadata_version: number;
  source_entry_id: string | null;
  is_system: number;
  allocation_id: string;
  amount: number;
  contributor: string;
  member_id: string | null;
  remaining_correctable: number;
  source_allocation_id: string | null;
}

export function publicEntriesStatement(
  database: Database,
  where = '1 = 1',
  values: (string | number)[] = [],
  limit = 25,
): D1PreparedStatement {
  return database
    .prepare(
      `WITH selected AS (
    SELECT e.id FROM beer_entries e LEFT JOIN entry_metadata m ON m.entry_id = e.id
    WHERE ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT ?
  ) SELECT e.id, e.total_amount, CASE WHEN ${publicTextCondition} THEN e.note ELSE NULL END AS note,
    e.created_at, e.local_day, e.allocation_count, m.occurred_at, m.occurrence_timezone, m.occurrence_precision,
    CASE WHEN ${publicTextCondition} THEN 1 ELSE 0 END AS text_public,
    m.title, m.short_note, m.venue, m.city, m.beer, m.brewery, coalesce(m.version, 0) AS metadata_version,
    c.source_entry_id, coalesce(cl.is_system, 0) AS is_system,
    a.id AS allocation_id, a.amount,
    CASE WHEN cm.public_display = 0 THEN 'Private member' ELSE a.contributor END AS contributor,
    CASE WHEN cm.public_display = 1 THEN am.member_id ELSE NULL END AS member_id,
    CASE WHEN a.amount > 0 THEN max(0, a.amount - coalesce((SELECT SUM(amount) FROM allocation_corrections WHERE source_allocation_id = a.id), 0)) ELSE 0 END AS remaining_correctable,
    ac.source_allocation_id
  FROM selected s JOIN beer_entries e ON e.id = s.id
  LEFT JOIN entry_metadata m ON m.entry_id = e.id
  LEFT JOIN entry_corrections c ON c.entry_id = e.id
  LEFT JOIN entry_classification cl ON cl.entry_id = e.id
  JOIN beer_events a ON a.entry_id = e.id
  LEFT JOIN allocation_members am ON am.allocation_id = a.id
  LEFT JOIN crew_members cm ON cm.id = am.member_id
  LEFT JOIN allocation_corrections ac ON ac.allocation_id = a.id
  ORDER BY e.created_at DESC, e.id DESC, a.allocation_index ASC`,
    )
    .bind(...values, limit);
}
export function groupPublicEntries(rows: PublicEntryRow[]): PublicEntry[] {
  const entries = new Map<string, PublicEntry>();
  for (const row of rows) {
    let entry = entries.get(row.id);
    if (!entry) {
      const hasMemory = [
        row.title,
        row.short_note,
        row.venue,
        row.city,
        row.beer,
        row.brewery,
      ].some(Boolean);
      entry = {
        id: row.id,
        totalAmount: row.total_amount,
        note: row.note,
        createdAt: row.created_at,
        localDay: row.local_day,
        isCorrection: row.total_amount < 0,
        isGroup: row.allocation_count > 1,
        allocations: [],
        occurredAt:
          !row.text_public || row.occurred_at === null
            ? null
            : new Date(row.occurred_at).toISOString(),
        occurrenceTimezone: row.text_public ? row.occurrence_timezone : null,
        occurrencePrecision: row.text_public ? row.occurrence_precision : null,
        occurrenceSource: !row.text_public || row.occurred_at === null ? 'unknown' : 'provided',
        memory:
          row.text_public && hasMemory
            ? {
                title: row.title,
                shortNote: row.short_note,
                venue: row.venue,
                city: row.city,
                beer: row.beer,
                brewery: row.brewery,
                visibility: 'public',
              }
            : null,
        metadataVersion: row.metadata_version,
        correctionOfEntryId: row.source_entry_id,
        correctionKind: row.total_amount < 0 ? (row.source_entry_id ? 'linked' : 'legacy') : null,
        isSystem: Boolean(row.is_system),
      };
      entries.set(row.id, entry);
    }
    entry.allocations.push({
      id: row.allocation_id,
      contributor: row.contributor,
      amount: row.amount,
      memberId: row.member_id,
      remainingCorrectable: row.remaining_correctable,
      sourceAllocationId: row.source_allocation_id,
    });
  }
  return [...entries.values()];
}
export async function publicEntry(database: Database, id: string): Promise<PublicEntry> {
  const result = await publicEntriesStatement(database, 'e.id = ?', [id], 1).all<PublicEntryRow>();
  const entry = groupPublicEntries(result.results)[0];
  if (!entry) throw new ApiError(404, 'Entry not found.', 'not_found');
  return entry;
}

function positiveLimit(params: URLSearchParams): number {
  const value = Number(params.get('limit') ?? 25);
  if (!Number.isInteger(value) || value < 1 || value > 50)
    throw new ApiError(400, 'Limit must be from 1 to 50.', 'invalid_query');
  return value;
}
function boundedQuery(value: string | null, maximum = 100): string | null {
  if (!value) return null;
  if (value.length > maximum) throw new ApiError(400, 'Search value is too long.', 'invalid_query');
  return value.trim() || null;
}
function like(value: string): string {
  return `%${value.replace(/[\\%_]/gu, '\\$&')}%`;
}
function day(value: string | null): string | null {
  if (!value) return null;
  if (
    !/^\d{4}-\d{2}-\d{2}$/u.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new ApiError(400, 'Date filters must be valid YYYY-MM-DD dates.', 'invalid_query');
  return value;
}
function decodeCursor(value: string | null): [number, string] | null {
  if (!value) return null;
  try {
    if (value.length > 512) throw new Error('length');
    const parsed: unknown = JSON.parse(atob(value));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'number' ||
      !Number.isSafeInteger(parsed[0]) ||
      typeof parsed[1] !== 'string' ||
      parsed[1].length > 256
    )
      throw new Error('shape');
    return [parsed[0], parsed[1]];
  } catch {
    throw new ApiError(400, 'Invalid history cursor.', 'invalid_cursor');
  }
}
function historyFilter(params: URLSearchParams): { where: string; values: (string | number)[] } {
  const clauses = ['1 = 1'];
  const values: (string | number)[] = [];
  const memberId = boundedQuery(params.get('memberId'), 256);
  if (memberId) {
    clauses.push(
      'EXISTS (SELECT 1 FROM allocation_members am JOIN crew_members cm ON cm.id = am.member_id WHERE am.entry_id = e.id AND am.member_id = ? AND cm.public_display = 1)',
    );
    values.push(memberId);
  }
  const basis = params.get('dateBasis') ?? 'recorded';
  if (basis !== 'recorded' && basis !== 'occurred')
    throw new ApiError(400, 'Date basis must be recorded or occurred.', 'invalid_query');
  const dateColumn = basis === 'occurred' ? 'm.occurred_day' : 'e.local_day';
  if (basis === 'occurred') clauses.push(`(${publicTextCondition}) AND m.occurred_at IS NOT NULL`);
  const from = day(params.get('from'));
  const to = day(params.get('to'));
  if (from && to && from > to) throw new ApiError(400, 'Date range is reversed.', 'invalid_query');
  if (from) {
    clauses.push(`${dateColumn} >= ?`);
    values.push(from);
  }
  if (to) {
    clauses.push(`${dateColumn} <= ?`);
    values.push(to);
  }
  for (const key of ['q', 'venue', 'brewery'] as const) {
    const text = boundedQuery(params.get(key));
    if (!text) continue;
    clauses.push(`(${publicTextCondition})`);
    if (key === 'q') {
      clauses.push(
        "(coalesce(m.title, '') || ' ' || coalesce(m.short_note, '') || ' ' || coalesce(e.note, '') || ' ' || coalesce(m.beer, '')) LIKE ? ESCAPE '\\'",
      );
    } else clauses.push(`m.${key} LIKE ? ESCAPE '\\'`);
    values.push(like(text));
  }
  if (params.get('community') === 'true')
    clauses.push(
      'NOT EXISTS (SELECT 1 FROM entry_classification cl WHERE cl.entry_id = e.id AND cl.is_system = 1)',
    );
  const cursor = decodeCursor(params.get('cursor'));
  if (cursor) {
    clauses.push('(e.created_at < ? OR (e.created_at = ? AND e.id < ?))');
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  return { where: clauses.join(' AND '), values };
}
export async function history(database: Database, params: URLSearchParams) {
  const limit = positiveLimit(params);
  const { where, values } = historyFilter(params);
  const result = await publicEntriesStatement(
    database,
    where,
    values,
    limit + 1,
  ).all<PublicEntryRow>();
  const all = groupPublicEntries(result.results);
  const entries = all.slice(0, limit);
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: all.length > limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null,
  };
}
export async function entryDetails(database: Database, id: string) {
  const entry = await publicEntry(database, id);
  const rows = await publicEntriesStatement(
    database,
    'EXISTS (SELECT 1 FROM entry_corrections c WHERE c.entry_id = e.id AND c.source_entry_id = ?)',
    [id],
    250,
  ).all<PublicEntryRow>();
  return { entry, corrections: groupPublicEntries(rows.results) };
}

interface MemberRow {
  id: string;
  display_name: string;
  allocation_count: number;
  positive_allocations: number;
  net_total: number;
  last_recorded_at: number | null;
  aliases: string;
}
const memberSelect = `SELECT m.id, m.display_name, coalesce(a.allocation_count, 0) AS allocation_count,
 coalesce(a.positive_allocations, 0) AS positive_allocations, coalesce(a.net_total, 0) AS net_total, a.last_recorded_at,
 (SELECT json_group_array(display_name) FROM (SELECT display_name FROM member_aliases WHERE member_id = m.id ORDER BY alias_key)) AS aliases
 FROM crew_members m LEFT JOIN community_member_activity a ON a.member_id = m.id`;
function publicMember(row: MemberRow) {
  return {
    id: row.id,
    displayName: row.display_name,
    aliases: JSON.parse(row.aliases) as string[],
    allocationCount: row.allocation_count,
    participationCount: row.positive_allocations,
    netTotal: row.net_total,
    lastRecordedAt: row.last_recorded_at,
  };
}
export async function members(database: Database, params: URLSearchParams) {
  const limit = positiveLimit(params);
  const values: (string | number)[] = [];
  const clauses = ['m.public_display = 1'];
  const q = boundedQuery(params.get('q'));
  if (q) {
    clauses.push(
      "(m.display_name LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM member_aliases x WHERE x.member_id = m.id AND x.display_name LIKE ? ESCAPE '\\'))",
    );
    values.push(like(q), like(q));
  }
  const cursor = boundedQuery(params.get('cursor'), 256);
  if (cursor) {
    clauses.push('m.id > ?');
    values.push(cursor);
  }
  const result = await database
    .prepare(`${memberSelect} WHERE ${clauses.join(' AND ')} ORDER BY m.id LIMIT ?`)
    .bind(...values, limit + 1)
    .all<MemberRow>();
  const list = result.results.slice(0, limit);
  return {
    members: list.map(publicMember),
    nextCursor: result.results.length > limit ? (list.at(-1)?.id ?? null) : null,
  };
}
export async function memberDetails(
  database: Database,
  id: string,
  params = new URLSearchParams(),
) {
  const row = await database
    .prepare(`${memberSelect} WHERE m.id = ? AND m.public_display = 1`)
    .bind(id)
    .first<MemberRow>();
  if (!row) throw new ApiError(404, 'Member not found.', 'not_found');
  params.set('memberId', id);
  return { member: publicMember(row), history: await history(database, params) };
}
export async function createMember(database: Database, value: unknown, actor: string) {
  await requireUpgradeWrites(database);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'A display name is required.', 'invalid_member');
  if (Object.keys(value).some((key) => key !== 'displayName'))
    throw new ApiError(
      400,
      'Only displayName is accepted. Privacy and ownership are not controlled by member creation.',
      'invalid_member',
    );
  const name = normalizeContributor((value as Record<string, unknown>).displayName, false);
  const key = normalizeContributorKey(name);
  if (key === 'anonymous')
    throw new ApiError(400, 'Anonymous does not have a member record.', 'invalid_member');
  const id = `member-${crypto.randomUUID()}`;
  try {
    await database.batch([
      database
        .prepare('INSERT INTO crew_members (id, display_name, created_at) VALUES (?, ?, ?)')
        .bind(id, name, Date.now()),
      database
        .prepare('INSERT INTO member_aliases (alias_key, member_id, display_name) VALUES (?, ?, ?)')
        .bind(key, id, name),
      database
        .prepare(
          'INSERT INTO projection_audit (id, action, target_id, actor, reason, after_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          crypto.randomUUID(),
          'member_create',
          id,
          actor,
          'Explicit shared-editor creation; no account ownership asserted.',
          JSON.stringify({ displayName: name }),
          Date.now(),
        ),
      database.prepare('UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1'),
    ]);
  } catch {
    if (
      await database.prepare('SELECT 1 FROM member_aliases WHERE alias_key = ?').bind(key).first()
    )
      throw new ApiError(
        409,
        'That name or alias already exists. Select its member from the directory.',
        'member_exists',
      );
    throw new ApiError(500, 'Unable to create member.', 'database_write_failed');
  }
  return { member: (await memberDetails(database, id)).member };
}

export async function recaps(
  database: Database,
  params: URLSearchParams,
  now = new Date(),
  timezone = 'America/Los_Angeles',
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const period =
    params.get('period') ??
    `${parts.find((p) => p.type === 'year')?.value}-${parts.find((p) => p.type === 'month')?.value}`;
  if (!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/u.test(period))
    throw new ApiError(400, 'Recap period must be YYYY or YYYY-MM.', 'invalid_query');
  const start = `${period.length === 4 ? `${period}-01` : period}-01`;
  day(start);
  const endDate = new Date(start);
  if (period.length === 4) endDate.setUTCFullYear(endDate.getUTCFullYear() + 1);
  else endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  const end = endDate.toISOString().slice(0, 10);
  params.set('from', start);
  params.set('to', end);
  params.set('dateBasis', 'recorded');
  params.set('community', 'true');
  const limit = positiveLimit(params);
  const filter = historyFilter(params);
  const results = await database.batch<Record<string, unknown>>([
    database
      .prepare(
        `SELECT coalesce(SUM(e.total_amount), 0) AS netTotal, COUNT(*) AS entryCount FROM beer_entries e WHERE e.local_day >= ? AND e.local_day <= ? AND NOT EXISTS (SELECT 1 FROM entry_classification cl WHERE cl.entry_id = e.id AND cl.is_system = 1)`,
      )
      .bind(start, end),
    database
      .prepare(
        `SELECT COUNT(DISTINCT am.member_id) AS participantCount FROM beer_entries e JOIN beer_events a ON a.entry_id = e.id JOIN allocation_members am ON am.allocation_id = a.id JOIN crew_members cm ON cm.id = am.member_id WHERE e.local_day >= ? AND e.local_day <= ? AND a.amount > 0 AND cm.public_display = 1 AND NOT EXISTS (SELECT 1 FROM entry_classification cl WHERE cl.entry_id = e.id AND cl.is_system = 1)`,
      )
      .bind(start, end),
    publicEntriesStatement(database, filter.where, filter.values, limit + 1),
  ]);
  const page = groupPublicEntries((results[2]?.results ?? []) as PublicEntryRow[]);
  const entries = page.slice(0, limit);
  const last = entries.at(-1);
  return {
    period,
    dateBasis: 'recorded' as const,
    ...results[0]?.results[0],
    ...results[1]?.results[0],
    entries,
    nextCursor:
      page.length > limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null,
  };
}

export async function onThisDate(database: Database, params: URLSearchParams, timezone: string) {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(Date.now());
  const monthDay =
    params.get('monthDay') ??
    `${today.find((p) => p.type === 'month')?.value}-${today.find((p) => p.type === 'day')?.value}`;
  if (!/^\d{2}-\d{2}$/u.test(monthDay))
    throw new ApiError(400, 'Memory date must be MM-DD.', 'invalid_query');
  day(`2000-${monthDay}`);
  const cursor = decodeCursor(params.get('cursor'));
  const limit = positiveLimit(params);
  const values: (string | number)[] = [monthDay];
  let where = `(${publicTextCondition}) AND m.occurred_at IS NOT NULL AND substr(m.occurred_day, 6) = ? AND NOT EXISTS (SELECT 1 FROM entry_classification c WHERE c.entry_id = e.id AND c.is_system = 1)`;
  if (cursor) {
    where += ' AND (e.created_at < ? OR (e.created_at = ? AND e.id < ?))';
    values.push(cursor[0], cursor[0], cursor[1]);
  }
  const rows = await publicEntriesStatement(
    database,
    where,
    values,
    limit + 1,
  ).all<PublicEntryRow>();
  const page = groupPublicEntries(rows.results);
  const entries = page.slice(0, limit);
  const last = entries.at(-1);
  return {
    dateBasis: 'occurred' as const,
    monthDay,
    entries,
    nextCursor:
      page.length > limit && last ? btoa(JSON.stringify([last.createdAt, last.id])) : null,
  };
}

export async function editMemory(database: Database, id: string, value: unknown, actor: string) {
  await requireUpgradeWrites(database);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'Invalid memory update.', 'invalid_memory');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => key !== 'memory' && key !== 'expectedVersion'))
    throw new ApiError(400, 'Unknown memory update field.', 'invalid_memory');
  const memory = parseMemory(input.memory);
  const version = input.expectedVersion;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0)
    throw new ApiError(400, 'The current metadata version is required.', 'invalid_memory');
  await publicEntry(database, id);
  const old = await database
    .prepare(
      'SELECT title, short_note, venue, city, beer, brewery, visibility, version FROM entry_metadata WHERE entry_id = ?',
    )
    .bind(id)
    .first();
  if (old?.visibility === 'private' || memory?.visibility === 'private') {
    throw new ApiError(
      403,
      'Changing memory visibility or editing private memories requires owner access.',
      'operator_required',
    );
  }
  if ((old?.version ?? 0) !== version)
    throw new ApiError(409, 'This memory changed. Refresh it before editing.', 'metadata_conflict');
  // A guarded UPDATE and its audit INSERT use changes() within the SAME D1 batch.
  const result = await database.batch([
    database.prepare('INSERT OR IGNORE INTO entry_metadata (entry_id) VALUES (?)').bind(id),
    database
      .prepare(
        "UPDATE entry_metadata SET title = ?, short_note = ?, venue = ?, city = ?, beer = ?, brewery = ?, visibility = ?, version = version + 1 WHERE entry_id = ? AND version = ? AND visibility = 'public' RETURNING version",
      )
      .bind(...memoryValues(memory), id, version),
    database
      .prepare(
        `INSERT INTO projection_audit (id, action, target_id, actor, reason, before_json, after_json, created_at) SELECT ?, 'memory_edit', ?, ?, ?, ?, ?, ? WHERE changes() = 1`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        actor,
        'Shared-editor memory update; immutable transaction preserved.',
        JSON.stringify(old),
        JSON.stringify(memory),
        Date.now(),
      ),
  ]);
  if (!result[1]?.results.length)
    throw new ApiError(409, 'This memory changed. Refresh it before editing.', 'metadata_conflict');
  return { entry: await publicEntry(database, id) };
}
export function memoryValues(memory?: MemoryInput | null): (string | null)[] {
  return [
    memory?.title ?? null,
    memory?.shortNote ?? null,
    memory?.venue ?? null,
    memory?.city ?? null,
    memory?.beer ?? null,
    memory?.brewery ?? null,
    memory?.visibility ?? 'public',
  ];
}

export type { PublicEntryRow };
