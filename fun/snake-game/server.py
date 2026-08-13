#!/usr/bin/env python3
"""Serve the snake game and proxy its two OpenAI-compatible API routes.

The browser never receives the API key. The proxy is intentionally bound to
loopback and only forwards the exact routes used by the demo.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Mapping
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
MAX_REQUEST_BYTES = 2 * 1024 * 1024
PROXY_ROUTES = {
    "/api/models": ("GET", "models"),
    "/api/chat/completions": ("POST", "chat/completions"),
}
FORWARDED_RESPONSE_HEADERS = {"content-type", "cache-control"}
STATIC_DIR = Path(__file__).resolve().parent


def normalize_base_url(value: str) -> str:
    """Return a normalized HTTP(S) API base URL without query or fragment."""
    parsed = urlsplit(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("TOKEN_FACTORY_BASE_URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(
            "TOKEN_FACTORY_BASE_URL must not contain credentials, query, or fragment"
        )
    path = parsed.path.rstrip("/") + "/"
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


def resolve_config(environ: Mapping[str, str]) -> tuple[str, str]:
    """Resolve an endpoint and its matching key without ambient-key confusion."""
    custom_base_url = environ.get("TOKEN_FACTORY_BASE_URL")
    if custom_base_url:
        api_key = environ.get("OPENAI_API_KEY") or environ.get("NEBIUS_API_KEY")
        if not api_key:
            raise ValueError(
                "Set OPENAI_API_KEY (or NEBIUS_API_KEY) for TOKEN_FACTORY_BASE_URL."
            )
        return api_key, normalize_base_url(custom_base_url)

    api_key = environ.get("NEBIUS_API_KEY")
    if not api_key:
        raise ValueError("Set NEBIUS_API_KEY before starting the server.")
    return api_key, DEFAULT_BASE_URL


class SnakeGameServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address: tuple[str, int], api_key: str, base_url: str):
        self.api_key = api_key
        self.base_url = normalize_base_url(base_url)
        super().__init__(address, SnakeGameHandler)


class SnakeGameHandler(SimpleHTTPRequestHandler):
    """Static-file handler with a narrow, same-origin API proxy."""

    server: SnakeGameServer

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'",
        )
        super().end_headers()

    def do_GET(self) -> None:
        if not self._allow_local_host():
            return
        if self.path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/snake.html")
            self.end_headers()
            return
        if urlsplit(self.path).path.startswith("/api/"):
            self._proxy("GET")
            return
        super().do_GET()

    def do_POST(self) -> None:
        if not self._allow_local_host():
            return
        if urlsplit(self.path).path.startswith("/api/"):
            self._proxy("POST")
            return
        self._send_json_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_OPTIONS(self) -> None:
        if not self._allow_local_host():
            return
        # Deliberately omit CORS support: browser calls must be same-origin.
        self._send_json_error(HTTPStatus.METHOD_NOT_ALLOWED, "CORS is not enabled")

    def _allow_local_host(self) -> bool:
        """Reject DNS-rebinding requests that use a non-local Host header."""
        try:
            hostname = urlsplit("//" + self.headers.get("Host", "")).hostname
        except ValueError:
            hostname = None
        if hostname not in {"127.0.0.1", "localhost"}:
            self._send_json_error(HTTPStatus.FORBIDDEN, "Use a localhost URL")
            return False
        return True

    def _proxy(self, method: str) -> None:
        parsed = urlsplit(self.path)
        route = PROXY_ROUTES.get(parsed.path)
        if route is None:
            self._send_json_error(HTTPStatus.NOT_FOUND, "Unsupported API route")
            return

        allowed_method, upstream_path = route
        if method != allowed_method:
            self._send_json_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")
            return

        body = None
        if method == "POST":
            if self.headers.get_content_type() != "application/json":
                self._send_json_error(
                    HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "Expected application/json"
                )
                return
            try:
                content_length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                self._send_json_error(HTTPStatus.BAD_REQUEST, "Invalid Content-Length")
                return
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                self._send_json_error(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Invalid request size"
                )
                return
            body = self.rfile.read(content_length)
            try:
                payload = json.loads(body)
            except (UnicodeDecodeError, json.JSONDecodeError):
                self._send_json_error(
                    HTTPStatus.BAD_REQUEST, "Request body must be valid JSON"
                )
                return
            if not isinstance(payload, dict):
                self._send_json_error(
                    HTTPStatus.BAD_REQUEST, "Request body must be a JSON object"
                )
                return

        query = parsed.query if upstream_path == "models" else ""
        upstream_url = self.server.base_url + upstream_path
        if query:
            upstream_url += "?" + query

        headers = {
            "Authorization": f"Bearer {self.server.api_key}",
            "Accept": self.headers.get("Accept", "application/json"),
            "User-Agent": "nebius-token-factory-snake-game/1.0",
        }
        if body is not None:
            headers["Content-Type"] = "application/json"

        request = Request(upstream_url, data=body, headers=headers, method=method)
        try:
            with urlopen(request, timeout=45) as response:
                self._relay_response(response.status, response.headers, response)
        except HTTPError as error:
            with error:
                self._relay_response(error.code, error.headers, error)
        except (URLError, TimeoutError) as error:
            reason = error.reason if isinstance(error, URLError) else "timeout"
            self._send_json_error(
                HTTPStatus.BAD_GATEWAY, f"Upstream request failed: {reason}"
            )

    def _relay_response(self, status: int, headers, response) -> None:
        self.send_response(status)
        for name, value in headers.items():
            if name.lower() in FORWARDED_RESPONSE_HEADERS:
                self.send_header(name, value)
        self.end_headers()

        # read1 allows SSE chat responses to reach the browser incrementally.
        reader = getattr(response, "read1", response.read)
        try:
            while chunk := reader(16 * 1024):
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            # Expected when a benchmark aborts after its first streamed token.
            return

    def _send_json_error(self, status: HTTPStatus, message: str) -> None:
        body = json.dumps({"error": {"message": message}}).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--port", type=int, default=8000, help="localhost port (default: 8000)"
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        api_key, base_url = resolve_config(os.environ)
        server = SnakeGameServer(("127.0.0.1", args.port), api_key, base_url)
    except ValueError as error:
        print(error, file=sys.stderr)
        return 2

    print(f"Snake game: http://127.0.0.1:{args.port}/snake.html")
    print(f"Proxying the allowlisted API routes to {server.base_url}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
