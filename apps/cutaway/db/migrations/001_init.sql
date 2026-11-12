-- One row per generated version. Versions of the same device share a slug.
CREATE TABLE teardowns (
  id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  name TEXT,
  name_key TEXT,
  category TEXT,
  summary TEXT,
  -- new | identifying | identified | designing | designed | reviewing | ready | failed
  status TEXT NOT NULL,
  input_kind TEXT NOT NULL CHECK (input_kind IN ('image', 'text')),
  input_hash TEXT NOT NULL,
  hint TEXT,
  identity_json TEXT,
  meta_json TEXT,
  review_rounds INTEGER NOT NULL DEFAULT 0,
  part_count INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  provider TEXT,
  model TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (slug, version)
);
CREATE INDEX teardowns_name_key ON teardowns (name_key, status);
CREATE INDEX teardowns_input_hash ON teardowns (input_hash);

CREATE TABLE inputs (
  teardown_id INTEGER PRIMARY KEY REFERENCES teardowns (id) ON DELETE CASCADE,
  image BLOB,
  mime TEXT,
  text TEXT
);

-- A photo is identified once; the same photo never pays for identify again.
CREATE TABLE identify_cache (
  input_hash TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE parts (
  teardown_id INTEGER NOT NULL REFERENCES teardowns (id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  code TEXT NOT NULL,
  ok INTEGER,
  error TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (teardown_id, part_id)
);

CREATE TABLE diagrams (
  teardown_id INTEGER NOT NULL REFERENCES teardowns (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  svg TEXT NOT NULL,
  PRIMARY KEY (teardown_id, kind)
);

CREATE TABLE thumbnails (
  teardown_id INTEGER PRIMARY KEY REFERENCES teardowns (id) ON DELETE CASCADE,
  image BLOB NOT NULL,
  mime TEXT NOT NULL
);

-- Every model call, so the run log shows exactly when Kimi ran and what it cost in tokens.
CREATE TABLE runs (
  id INTEGER PRIMARY KEY,
  teardown_id INTEGER REFERENCES teardowns (id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,
  latency_ms INTEGER,
  error TEXT,
  raw_response TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX runs_teardown ON runs (teardown_id);

-- Study data is keyed by slug so it survives regenerating a device.
CREATE TABLE bookmarks (
  slug TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE notes (
  slug TEXT NOT NULL,
  part_id TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (slug, part_id)
);

CREATE TABLE progress (
  slug TEXT PRIMARY KEY,
  parts_opened TEXT NOT NULL DEFAULT '[]',
  steps_done TEXT NOT NULL DEFAULT '[]',
  quiz TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
