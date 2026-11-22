"""Storage: SingleStore when SINGLESTORE_URL is set (mysql://user:pass@host:port/db), else local SQLite.

Everything is stored as JSON documents in a few tables so the same SQL runs on both.
"""
import json
import sqlite3
import threading
from urllib.parse import urlparse, unquote

from .config import DB_PATH, env

TABLES = ["occasions", "orders", "trail", "memory", "claims", "chat",
          "runs", "requests", "prefs", "plans", "approvals", "actions", "audit"]
_lock = threading.Lock()


class DB:
    def __init__(self):
        url = env("SINGLESTORE_URL")
        self.kind, self.blocker = "sqlite", ""
        if url:
            import time as _t
            for attempt in range(4):  # transient connect errors (2003) happen after a cluster resumes
                try:
                    import pymysql
                    u = urlparse(url)
                    self.conn = pymysql.connect(host=u.hostname, port=u.port or 3306, user=unquote(u.username or ""),
                                                password=unquote(u.password or ""), database=u.path.lstrip("/"),
                                                ssl={"ssl": {}} if "singlestore.com" in (u.hostname or "") else None,
                                                autocommit=True, connect_timeout=10, read_timeout=20, write_timeout=20)
                    self.conn.cursor().execute("SELECT 1")
                    self.kind, self.ph, self.blocker = "singlestore", "%s", ""
                    break
                except Exception as e:  # keep the adapter isolated; never print the URL
                    code = getattr(e, "args", [""])[0]
                    self.blocker = f"SingleStore connect failed ({type(e).__name__} {code}); using local SQLite demo fixture"
                    _t.sleep(3)
            if self.blocker:
                print(self.blocker)
        if self.kind == "sqlite":
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            self.ph = "?"
        for t in TABLES:
            self._exec(f"CREATE TABLE IF NOT EXISTS {t} (id VARCHAR(128) PRIMARY KEY, grp VARCHAR(128), "
                       f"seq BIGINT, doc TEXT)")

    def _exec(self, sql, args=()):
        with _lock:
            cur = self.conn.cursor()
            try:
                cur.execute(sql, args)
            except Exception:
                if self.kind != "singlestore":
                    raise
                self.conn.ping(reconnect=True)  # dropped connection: reconnect once and retry
                cur = self.conn.cursor()
                cur.execute(sql, args)
            rows = cur.fetchall() if cur.description else []
            if self.kind == "sqlite":
                self.conn.commit()
            return rows

    def put(self, table, id, doc, grp="", seq=0):
        p = self.ph  # REPLACE works on both SQLite and SingleStore: one round trip per write
        self._exec(f"REPLACE INTO {table} (id, grp, seq, doc) VALUES ({p},{p},{p},{p})", (id, grp, seq, json.dumps(doc)))

    def get(self, table, id):
        r = self._exec(f"SELECT doc FROM {table} WHERE id={self.ph}", (id,))
        return json.loads(r[0][0]) if r else None

    def list(self, table, grp=None):
        if grp is None:
            r = self._exec(f"SELECT doc FROM {table} ORDER BY seq, id")
        else:
            r = self._exec(f"SELECT doc FROM {table} WHERE grp={self.ph} ORDER BY seq, id", (grp,))
        return [json.loads(x[0]) for x in r]

    def delete(self, table, id):
        self._exec(f"DELETE FROM {table} WHERE id={self.ph}", (id,))

    def clear(self, keep_groups=("system", "senso_cache")):
        """Reset demo state, but keep one-time setup markers (Senso KB loaded, Cognee seeded) and cached checks."""
        for t in TABLES:
            keep = ",".join(f"'{g}'" for g in keep_groups)
            self._exec(f"DELETE FROM {t} WHERE grp NOT IN ({keep})")


db = DB()
