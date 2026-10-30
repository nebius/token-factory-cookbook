"""In-cluster HTTP probe. Fetches URLs inside its own namespace only, for bounded checks."""
from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

NAMESPACE = os.environ.get("POD_NAMESPACE", "default")
MAX_BODY = 4096


def allowed(url: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "http":
        return False
    return host.count(".") == 0 or host.endswith(f".{NAMESPACE}.svc") or host.endswith(f".{NAMESPACE}.svc.cluster.local")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:
        pass

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/healthz":
            self._send(200, {"status": "ok"})
            return
        if parsed.path != "/probe":
            self._send(404, {"error": "not found"})
            return
        query = urllib.parse.parse_qs(parsed.query)
        url = (query.get("url") or [""])[0]
        method = (query.get("method") or ["GET"])[0].upper()
        body = (query.get("body") or [None])[0]
        if method not in {"GET", "POST"} or not allowed(url):
            self._send(400, {"error": "probe target not allowed", "url": url})
            return
        data = body.encode() if body is not None else None
        req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
        started = time.monotonic()
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                status, text = resp.status, resp.read(MAX_BODY).decode(errors="replace")
        except urllib.error.HTTPError as exc:
            status, text = exc.code, exc.read(MAX_BODY).decode(errors="replace")
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            self._send(200, {"ok": False, "error": f"{type(exc).__name__}: {getattr(exc, 'reason', exc)}",
                             "latency_ms": round((time.monotonic() - started) * 1000)})
            return
        self._send(200, {"ok": True, "status": status, "body": text, "latency_ms": round((time.monotonic() - started) * 1000)})


def main() -> None:
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Handler).serve_forever()


if __name__ == "__main__":
    main()
