-- Additive projections only. 0001/0002 and every original ledger field are unchanged.
-- The migration transaction installs both backfill and bridges before writes resume.
CREATE TABLE upgrade_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL CHECK (revision >= 0),
  mutations_enabled INTEGER NOT NULL DEFAULT 0 CHECK (mutations_enabled IN (0, 1)),
  schema_version INTEGER NOT NULL DEFAULT 3 CHECK (schema_version = 3)
);
INSERT INTO upgrade_state (id, revision) SELECT 1, COUNT(*) FROM beer_entries;
CREATE TRIGGER crew_revision_entry AFTER INSERT ON beer_entries BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TABLE crew_members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  public_display INTEGER NOT NULL DEFAULT 1 CHECK (public_display IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_crew_members_name ON crew_members (display_name COLLATE NOCASE, id);
CREATE TABLE member_aliases (
  alias_key TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES crew_members(id),
  display_name TEXT NOT NULL
);
CREATE INDEX idx_member_aliases_member ON member_aliases (member_id, alias_key);
CREATE TABLE allocation_members (
  allocation_id TEXT PRIMARY KEY REFERENCES beer_events(id) ON DELETE CASCADE,
  -- Deliberately no parent FK: the 0001 compatibility trigger may promote the
  -- parent later in this same INSERT statement, regardless of trigger order.
  entry_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES crew_members(id)
);
CREATE INDEX idx_allocation_members_member ON allocation_members (member_id, entry_id);
-- Historical alias merges may leave two allocations for one member in a group.
-- Existing mappings remain; the insert trigger rejects duplicates in NEW writes.
CREATE INDEX idx_allocation_members_entry_member ON allocation_members (entry_id, member_id);
CREATE TABLE contributor_activity (
  contributor_key TEXT PRIMARY KEY,
  positive_allocations INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE member_activity (
  member_id TEXT PRIMARY KEY REFERENCES crew_members(id) ON DELETE CASCADE,
  allocation_count INTEGER NOT NULL DEFAULT 0,
  positive_allocations INTEGER NOT NULL DEFAULT 0,
  net_total INTEGER NOT NULL DEFAULT 0,
  last_recorded_at INTEGER
);

INSERT INTO crew_members (id, display_name, created_at)
SELECT 'member-' || e.id, e.contributor, e.created_at
FROM beer_events e
WHERE e.contributor_key <> '' AND e.contributor_key <> 'anonymous'
  AND e.id = (SELECT x.id FROM beer_events x WHERE x.contributor_key = e.contributor_key
              ORDER BY x.created_at, x.id LIMIT 1);
INSERT INTO member_aliases (alias_key, member_id, display_name)
SELECT e.contributor_key, m.id, m.display_name FROM beer_events e
JOIN crew_members m ON m.id = 'member-' || (SELECT x.id FROM beer_events x WHERE x.contributor_key = e.contributor_key ORDER BY x.created_at, x.id LIMIT 1)
GROUP BY e.contributor_key;
INSERT INTO allocation_members (allocation_id, entry_id, member_id)
SELECT e.id, e.entry_id, a.member_id FROM beer_events e
JOIN member_aliases a ON a.alias_key = e.contributor_key;
INSERT INTO contributor_activity (contributor_key, positive_allocations)
SELECT contributor_key, SUM(amount > 0) FROM beer_events
WHERE contributor_key <> '' AND contributor_key <> 'anonymous' GROUP BY contributor_key;
INSERT INTO member_activity (member_id, allocation_count, positive_allocations, net_total, last_recorded_at)
SELECT am.member_id, COUNT(*), SUM(e.amount > 0), SUM(e.amount), MAX(e.created_at)
FROM allocation_members am JOIN beer_events e ON e.id = am.allocation_id GROUP BY am.member_id;

CREATE TRIGGER crew_member_bridge AFTER INSERT ON beer_events
WHEN NEW.contributor_key <> '' AND NEW.contributor_key <> 'anonymous'
BEGIN
  INSERT OR IGNORE INTO crew_members (id, display_name, created_at)
  SELECT 'member-' || NEW.id, NEW.contributor, NEW.created_at
  WHERE NOT EXISTS (SELECT 1 FROM member_aliases WHERE alias_key = NEW.contributor_key);
  INSERT OR IGNORE INTO member_aliases (alias_key, member_id, display_name)
  SELECT NEW.contributor_key, 'member-' || NEW.id, NEW.contributor
  WHERE NOT EXISTS (SELECT 1 FROM member_aliases WHERE alias_key = NEW.contributor_key);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM allocation_members am JOIN member_aliases a ON a.member_id = am.member_id
    WHERE am.entry_id = coalesce(NEW.entry_id, 'legacy-' || NEW.id) AND a.alias_key = NEW.contributor_key
  ) AND NOT EXISTS (SELECT 1 FROM entry_corrections WHERE entry_id = NEW.entry_id)
  THEN RAISE(ABORT, 'duplicate_member') END;
  INSERT INTO allocation_members (allocation_id, entry_id, member_id)
  SELECT NEW.id, coalesce(NEW.entry_id, 'legacy-' || NEW.id), member_id
  FROM member_aliases WHERE alias_key = NEW.contributor_key;
  INSERT INTO contributor_activity (contributor_key, positive_allocations)
  VALUES (NEW.contributor_key, NEW.amount > 0)
  ON CONFLICT(contributor_key) DO UPDATE SET positive_allocations = positive_allocations + (NEW.amount > 0);
END;
CREATE TRIGGER crew_activity_insert AFTER INSERT ON allocation_members BEGIN
  INSERT INTO member_activity (member_id, allocation_count, positive_allocations, net_total, last_recorded_at)
  SELECT NEW.member_id, 1, amount > 0, amount, created_at FROM beer_events WHERE id = NEW.allocation_id
  ON CONFLICT(member_id) DO UPDATE SET
    allocation_count = allocation_count + 1,
    positive_allocations = positive_allocations + excluded.positive_allocations,
    net_total = net_total + excluded.net_total,
    last_recorded_at = max(coalesce(last_recorded_at, 0), excluded.last_recorded_at);
END;
-- Projection movement is reserved for the owner operator, and preserves source rows.
CREATE TRIGGER crew_activity_move AFTER UPDATE OF member_id ON allocation_members BEGIN
  INSERT OR IGNORE INTO member_activity (member_id) VALUES (NEW.member_id);
  UPDATE member_activity SET
    allocation_count = (SELECT COUNT(*) FROM allocation_members WHERE member_id = member_activity.member_id),
    positive_allocations = (SELECT coalesce(SUM(e.amount > 0), 0) FROM allocation_members am JOIN beer_events e ON e.id = am.allocation_id WHERE am.member_id = member_activity.member_id),
    net_total = (SELECT coalesce(SUM(e.amount), 0) FROM allocation_members am JOIN beer_events e ON e.id = am.allocation_id WHERE am.member_id = member_activity.member_id),
    last_recorded_at = (SELECT MAX(e.created_at) FROM allocation_members am JOIN beer_events e ON e.id = am.allocation_id WHERE am.member_id = member_activity.member_id)
  WHERE member_id IN (OLD.member_id, NEW.member_id);
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER crew_member_revision AFTER UPDATE ON crew_members BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER crew_alias_revision AFTER UPDATE ON member_aliases BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;

CREATE TABLE entry_metadata (
  entry_id TEXT PRIMARY KEY REFERENCES beer_entries(id) ON DELETE CASCADE,
  occurred_at INTEGER,
  occurred_day TEXT,
  occurrence_timezone TEXT,
  occurrence_precision TEXT CHECK (occurrence_precision IS NULL OR occurrence_precision IN ('day', 'minute')),
  title TEXT CHECK (title IS NULL OR length(title) <= 80),
  short_note TEXT CHECK (short_note IS NULL OR length(short_note) <= 140),
  venue TEXT CHECK (venue IS NULL OR length(venue) <= 80),
  city TEXT CHECK (city IS NULL OR length(city) <= 80),
  beer TEXT CHECK (beer IS NULL OR length(beer) <= 80),
  brewery TEXT CHECK (brewery IS NULL OR length(brewery) <= 80),
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  -- Immutable ORIGINAL request, deliberately independent of metadata edits/renames.
  payload_json TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0)
);
CREATE INDEX idx_metadata_occurred ON entry_metadata (occurred_at DESC, entry_id DESC);
CREATE INDEX idx_metadata_occurred_day ON entry_metadata (occurred_day, entry_id);
CREATE INDEX idx_metadata_anniversary ON entry_metadata (substr(occurred_day, 6), entry_id);
CREATE INDEX idx_metadata_venue ON entry_metadata (venue COLLATE NOCASE, entry_id);
CREATE INDEX idx_metadata_brewery ON entry_metadata (brewery COLLATE NOCASE, entry_id);
CREATE TRIGGER crew_metadata_revision_insert AFTER INSERT ON entry_metadata BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER crew_metadata_revision_update AFTER UPDATE ON entry_metadata BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
-- Flags are checked inside the write transaction as well as at the API edge.
-- Old name-only payloads remain writable while enhanced features are disabled.
CREATE TRIGGER crew_metadata_write_gate BEFORE INSERT ON entry_metadata
WHEN (SELECT mutations_enabled FROM upgrade_state WHERE id = 1) = 0
  AND NEW.payload_json IS NOT NULL
  AND (NEW.occurred_at IS NOT NULL
    OR json_type(NEW.payload_json, '$.memory') = 'object'
    OR json_type(NEW.payload_json, '$.correctionOfEntryId') = 'text'
    OR EXISTS (SELECT 1 FROM json_each(NEW.payload_json, '$.allocations')
       WHERE json_type(value, '$.memberId') = 'text' OR json_type(value, '$.sourceAllocationId') = 'text'))
BEGIN SELECT RAISE(ABORT, 'feature_disabled'); END;
CREATE TABLE entry_classification (
  entry_id TEXT PRIMARY KEY REFERENCES beer_entries(id) ON DELETE CASCADE,
  is_system INTEGER NOT NULL CHECK (is_system IN (0, 1)),
  evidence TEXT NOT NULL CHECK (length(evidence) > 0)
);
CREATE TRIGGER crew_classification_insert AFTER INSERT ON entry_classification BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER crew_classification_update AFTER UPDATE ON entry_classification BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE TRIGGER crew_classification_delete AFTER DELETE ON entry_classification BEGIN
  UPDATE upgrade_state SET revision = revision + 1 WHERE id = 1;
END;
CREATE VIEW community_member_activity AS
WITH excluded AS (
  SELECT am.member_id, COUNT(*) AS allocation_count, SUM(e.amount > 0) AS positive_allocations, SUM(e.amount) AS net_total
  FROM entry_classification c JOIN beer_events e ON e.entry_id = c.entry_id
  JOIN allocation_members am ON am.allocation_id = e.id WHERE c.is_system = 1 GROUP BY am.member_id
)
SELECT a.member_id, a.allocation_count - coalesce(x.allocation_count, 0) AS allocation_count,
  a.positive_allocations - coalesce(x.positive_allocations, 0) AS positive_allocations,
  a.net_total - coalesce(x.net_total, 0) AS net_total,
  CASE WHEN x.member_id IS NULL THEN a.last_recorded_at ELSE (
    SELECT MAX(e.created_at) FROM allocation_members am JOIN beer_events e ON e.id = am.allocation_id
    WHERE am.member_id = a.member_id AND NOT EXISTS (
      SELECT 1 FROM entry_classification c WHERE c.entry_id = e.entry_id AND c.is_system = 1)
  ) END AS last_recorded_at
FROM member_activity a LEFT JOIN excluded x ON x.member_id = a.member_id;

CREATE TABLE entry_corrections (
  entry_id TEXT PRIMARY KEY REFERENCES beer_entries(id) ON DELETE CASCADE,
  source_entry_id TEXT NOT NULL REFERENCES beer_entries(id)
);
CREATE INDEX idx_entry_corrections_source ON entry_corrections (source_entry_id, entry_id);
CREATE TABLE allocation_corrections (
  allocation_id TEXT PRIMARY KEY REFERENCES beer_events(id) ON DELETE CASCADE,
  source_allocation_id TEXT NOT NULL REFERENCES beer_events(id),
  amount INTEGER NOT NULL CHECK (amount BETWEEN 1 AND 250)
);
CREATE INDEX idx_allocation_corrections_source ON allocation_corrections (source_allocation_id, amount);
CREATE TRIGGER crew_correction_parent BEFORE INSERT ON entry_corrections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM beer_entries s, beer_entries c
    WHERE s.id = NEW.source_entry_id AND c.id = NEW.entry_id AND s.total_amount > 0 AND c.total_amount < 0
      AND s.total_amount + coalesce((SELECT SUM(p.total_amount) FROM entry_corrections l JOIN beer_entries p ON p.id = l.entry_id WHERE l.source_entry_id = s.id), 0) >= -c.total_amount
  ) THEN RAISE(ABORT, 'correction_allowance') END;
END;
CREATE TRIGGER crew_correction_allocation BEFORE INSERT ON allocation_corrections BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM beer_events s, beer_events c JOIN entry_corrections l ON l.entry_id = c.entry_id
    WHERE s.id = NEW.source_allocation_id AND c.id = NEW.allocation_id
      AND s.entry_id = l.source_entry_id AND s.amount > 0 AND c.amount = -NEW.amount
      AND s.contributor_key = c.contributor_key
      AND s.amount - coalesce((SELECT SUM(amount) FROM allocation_corrections WHERE source_allocation_id = s.id), 0) >= NEW.amount
  ) THEN RAISE(ABORT, 'correction_allowance') END;
END;
CREATE TABLE projection_audit (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  target_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at INTEGER NOT NULL,
  reverses_audit_id TEXT REFERENCES projection_audit(id)
);
INSERT INTO projection_audit (id, action, target_id, actor, reason, before_json, after_json, created_at)
SELECT 'backfill-labels-' || a.member_id, 'backfill_label_variants', a.member_id,
  'migration-0003', 'Different source labels share an existing normalized key; no real-person identity inferred.',
  json_group_array(DISTINCT e.contributor), '{"identityBasis":"existing normalized contributor key"}',
  unixepoch('now') * 1000
FROM beer_events e JOIN member_aliases a ON a.alias_key = e.contributor_key
GROUP BY a.member_id HAVING COUNT(DISTINCT e.contributor) > 1;
CREATE INDEX idx_projection_audit_target ON projection_audit (target_id, created_at);
CREATE TRIGGER crew_projection_write_gate BEFORE INSERT ON projection_audit
WHEN NEW.action IN ('member_create', 'memory_edit')
  AND (SELECT mutations_enabled FROM upgrade_state WHERE id = 1) = 0
BEGIN SELECT RAISE(ABORT, 'feature_disabled'); END;
CREATE INDEX idx_entries_cursor ON beer_entries (created_at DESC, id DESC);
