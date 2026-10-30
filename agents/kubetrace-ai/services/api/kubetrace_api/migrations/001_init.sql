CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  scenario_id TEXT NOT NULL,
  provenance TEXT NOT NULL,          -- fixture | local-live | civo-live | replay
  replay_of TEXT,                    -- original provenance when imported for replay
  provider TEXT,
  model TEXT,
  policy_mode TEXT,
  state TEXT NOT NULL,               -- setting_up | baseline_ready | detected | investigating | ... | resolved | escalated | unresolved | blocked | cancelled | error
  created_at REAL NOT NULL,
  started_at REAL,
  ended_at REAL,
  repo_commit TEXT,
  cluster TEXT,                      -- JSON
  settings TEXT,                     -- JSON: prompt/tool-schema versions, generation settings, limits
  metrics TEXT,                      -- JSON
  outcome TEXT,                      -- JSON
  first_attempt_success INTEGER,
  eventual_success INTEGER,
  error TEXT
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL,
  ts REAL NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX events_run ON events(run_id, id);
CREATE TABLE experiments (
  scenario_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  run_id TEXT,
  updated_at REAL NOT NULL,
  detail TEXT
);
