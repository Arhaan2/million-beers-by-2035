CREATE TABLE challenge_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  updated_at INTEGER NOT NULL
);

INSERT INTO challenge_state (id, total, event_count, updated_at) VALUES (1, 0, 0, 0);

CREATE TABLE beer_events (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  amount INTEGER NOT NULL CHECK (amount <> 0 AND amount BETWEEN -250 AND 250),
  contributor TEXT NOT NULL CHECK (length(contributor) BETWEEN 1 AND 30),
  contributor_key TEXT NOT NULL CHECK (length(contributor_key) BETWEEN 1 AND 30),
  note TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 140),
  created_at INTEGER NOT NULL,
  local_day TEXT NOT NULL CHECK (length(local_day) = 10),
  session_fingerprint TEXT NOT NULL
);

CREATE INDEX idx_beer_events_created_at ON beer_events (created_at DESC);
CREATE INDEX idx_beer_events_local_day ON beer_events (local_day);
CREATE INDEX idx_beer_events_contributor_key ON beer_events (contributor_key);

CREATE TABLE contributor_totals (
  contributor_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 30),
  net_total INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_contributor_totals_rank ON contributor_totals (net_total DESC, updated_at DESC);

CREATE TABLE daily_totals (
  local_day TEXT PRIMARY KEY CHECK (length(local_day) = 10),
  net_total INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE rate_limits (
  scope TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count >= 0),
  PRIMARY KEY (scope, key_hash)
);

CREATE INDEX idx_rate_limits_window ON rate_limits (window_started_at);
