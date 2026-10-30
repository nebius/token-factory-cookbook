"""SQLite storage with numbered migrations. Events are appended as they happen, so a UI that
disconnects can replay everything from the last id it saw."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

MIGRATIONS = Path(__file__).parent / "migrations"
JSON_COLUMNS = {"cluster", "settings", "metrics", "outcome"}


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._seq_lock = threading.Lock()
        self.migrate()

    def conn(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, timeout=30, isolation_level=None, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            self._local.conn = conn
        return conn

    def migrate(self) -> list[str]:
        conn = self.conn()
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at REAL NOT NULL)")
        done = {r["version"] for r in conn.execute("SELECT version FROM schema_migrations")}
        applied = []
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.stem in done:
                continue
            conn.executescript("BEGIN;" + path.read_text() + ";COMMIT;")
            conn.execute("INSERT INTO schema_migrations VALUES (?, ?)", (path.stem, time.time()))
            applied.append(path.stem)
        return applied

    # Runs ------------------------------------------------------------------------------------
    def create_run(self, **fields: Any) -> None:
        fields = {k: json.dumps(v) if k in JSON_COLUMNS and v is not None else v for k, v in fields.items()}
        cols = ", ".join(fields)
        self.conn().execute(f"INSERT INTO runs ({cols}) VALUES ({', '.join('?' * len(fields))})", tuple(fields.values()))

    def update_run(self, run_id: str, **fields: Any) -> None:
        if not fields:
            return
        fields = {k: json.dumps(v) if k in JSON_COLUMNS and v is not None else v for k, v in fields.items()}
        sets = ", ".join(f"{k} = ?" for k in fields)
        self.conn().execute(f"UPDATE runs SET {sets} WHERE id = ?", (*fields.values(), run_id))

    def get_run(self, run_id: str) -> dict | None:
        row = self.conn().execute("SELECT * FROM runs WHERE id = ?", (run_id,)).fetchone()
        return _run_dict(row) if row else None

    def list_runs(self, limit: int = 200) -> list[dict]:
        rows = self.conn().execute("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [_run_dict(r) for r in rows]

    # Events ----------------------------------------------------------------------------------
    def append_event(self, run_id: str, type_: str, payload: dict) -> dict:
        with self._seq_lock:
            conn = self.conn()
            seq = conn.execute("SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE run_id = ?", (run_id,)).fetchone()[0]
            ts = time.time()
            cur = conn.execute("INSERT INTO events (run_id, seq, ts, type, payload) VALUES (?, ?, ?, ?, ?)",
                               (run_id, seq, ts, type_, json.dumps(payload, default=str)))
        return {"id": cur.lastrowid, "run_id": run_id, "seq": seq, "ts": ts, "type": type_, "payload": payload}

    def events(self, run_id: str, after_id: int = 0, limit: int = 1000) -> list[dict]:
        rows = self.conn().execute("SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id LIMIT ?",
                                   (run_id, after_id, limit)).fetchall()
        return [{"id": r["id"], "run_id": r["run_id"], "seq": r["seq"], "ts": r["ts"], "type": r["type"],
                 "payload": json.loads(r["payload"])} for r in rows]

    # Experiments -----------------------------------------------------------------------------
    def set_experiment(self, scenario_id: str, state: str, run_id: str | None, detail: dict | None = None) -> None:
        self.conn().execute(
            "INSERT INTO experiments (scenario_id, state, run_id, updated_at, detail) VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(scenario_id) DO UPDATE SET state = excluded.state, run_id = excluded.run_id, "
            "updated_at = excluded.updated_at, detail = excluded.detail",
            (scenario_id, state, run_id, time.time(), json.dumps(detail or {})))

    def experiments(self) -> dict[str, dict]:
        rows = self.conn().execute("SELECT * FROM experiments").fetchall()
        return {r["scenario_id"]: {"state": r["state"], "run_id": r["run_id"], "updated_at": r["updated_at"],
                                   "detail": json.loads(r["detail"] or "{}")} for r in rows}


def _run_dict(row: sqlite3.Row) -> dict:
    out = dict(row)
    for key in JSON_COLUMNS:
        if out.get(key):
            out[key] = json.loads(out[key])
    return out
