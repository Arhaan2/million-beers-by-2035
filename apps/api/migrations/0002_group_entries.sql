CREATE TABLE beer_entries (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  total_amount INTEGER NOT NULL CHECK (total_amount <> 0 AND total_amount BETWEEN -250 AND 250),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 140),
  allocation_count INTEGER NOT NULL CHECK (allocation_count BETWEEN 1 AND 25),
  created_at INTEGER NOT NULL,
  local_day TEXT NOT NULL CHECK (length(local_day) = 10),
  session_fingerprint TEXT NOT NULL
);

CREATE INDEX idx_beer_entries_created_at ON beer_entries (created_at DESC);
CREATE INDEX idx_beer_entries_local_day ON beer_entries (local_day);

ALTER TABLE beer_events ADD COLUMN entry_id TEXT;
ALTER TABLE beer_events ADD COLUMN allocation_index INTEGER;

INSERT INTO beer_entries (
  id,
  idempotency_key,
  total_amount,
  note,
  allocation_count,
  created_at,
  local_day,
  session_fingerprint
)
SELECT
  'legacy-' || id,
  idempotency_key,
  amount,
  note,
  1,
  created_at,
  local_day,
  session_fingerprint
FROM beer_events;

UPDATE beer_events
SET entry_id = 'legacy-' || id,
    allocation_index = 0;

CREATE UNIQUE INDEX idx_beer_events_entry_allocation
  ON beer_events (entry_id, allocation_index);
CREATE INDEX idx_beer_events_entry_id ON beer_events (entry_id);

ALTER TABLE challenge_state
  ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0);
UPDATE challenge_state SET entry_count = event_count;

ALTER TABLE daily_totals
  ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0);
UPDATE daily_totals SET entry_count = event_count;

-- During the migration-to-deploy window, the old Worker may still insert a
-- child event without a parent. Promote that event to a single-allocation entry
-- and update only the new entry counters; the old Worker updates all old fields.
CREATE TRIGGER beer_events_legacy_entry_compat
AFTER INSERT ON beer_events
WHEN NEW.entry_id IS NULL
BEGIN
  INSERT INTO beer_entries (
    id,
    idempotency_key,
    total_amount,
    note,
    allocation_count,
    created_at,
    local_day,
    session_fingerprint
  ) VALUES (
    'legacy-' || NEW.id,
    NEW.idempotency_key,
    NEW.amount,
    NEW.note,
    1,
    NEW.created_at,
    NEW.local_day,
    NEW.session_fingerprint
  );

  UPDATE beer_events
  SET entry_id = 'legacy-' || NEW.id,
      allocation_index = 0
  WHERE id = NEW.id;

  UPDATE challenge_state
  SET entry_count = entry_count + 1
  WHERE id = 1;

  INSERT INTO daily_totals (local_day, net_total, event_count, entry_count, updated_at)
  VALUES (NEW.local_day, 0, 0, 1, NEW.created_at)
  ON CONFLICT(local_day) DO UPDATE SET
    entry_count = daily_totals.entry_count + 1;
END;
