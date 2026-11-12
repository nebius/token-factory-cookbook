"""Storefront checkout service. Standard library only, so the image stays small."""
from __future__ import annotations

import json
import logging
import os
import sys
import threading
import traceback
import urllib.error
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import config as config_module
from .pricing import CATALOG, PricingError, quote

log = logging.getLogger("storefront")
STATE: dict = {"ready": False, "config": None, "cache": None}


def warm_cache(megabytes: int) -> bytearray:
    """Preload the product image cache. Touches every page so the memory is really used."""
    block = bytearray(megabytes * 1024 * 1024)
    for offset in range(0, len(block), 4096):
        block[offset] = 1
    return block


def authorize_payment(gateway: str, amount: str, request_id: str) -> None:
    body = json.dumps({"amount": amount, "request_id": request_id}).encode()
    req = urllib.request.Request(f"{gateway.rstrip('/')}/authorize", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=2) as resp:
        result = json.load(resp)
    if not result.get("approved"):
        raise RuntimeError("payment declined")


class Handler(BaseHTTPRequestHandler):
    server_version = "storefront"

    def log_message(self, fmt: str, *args) -> None:  # route access logs through logging
        log.info("access %s %s", self.address_string(), fmt % args)

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send(200, {"status": "ok"})
        elif self.path == "/readyz":
            if STATE["ready"]:
                self._send(200, {"status": "ready"})
            else:
                self._send(503, {"status": "starting"})
        elif self.path == "/version":
            self._send(200, {"version": os.environ.get("APP_VERSION", "dev")})
        elif self.path == "/api/catalog":
            self._send(200, {sku: {"name": p["name"], "price": str(p["price"])} for sku, p in CATALOG.items()})
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/api/checkout":
            self._send(404, {"error": "not found"})
            return
        request_id = self.headers.get("X-Request-Id") or uuid.uuid4().hex[:12]
        try:
            length = int(self.headers.get("Content-Length") or 0)
            order = json.loads(self.rfile.read(length) or b"{}")
            cfg = STATE["config"]
            result = quote(order.get("items") or [], order.get("coupon"), cfg["pricing"])
            if cfg["payment_gateway_url"]:
                try:
                    authorize_payment(cfg["payment_gateway_url"], result["total"], request_id)
                except (urllib.error.URLError, TimeoutError, OSError, RuntimeError) as exc:
                    log.error("checkout %s payment gateway %s unavailable: %s", request_id, cfg["payment_gateway_url"], exc)
                    self._send(502, {"error": "payment gateway unavailable", "request_id": request_id})
                    return
            log.info("checkout %s ok total=%s", request_id, result["total"])
            self._send(200, {**result, "request_id": request_id})
        except (PricingError, json.JSONDecodeError, AttributeError, TypeError) as exc:
            log.warning("checkout %s rejected: %s", request_id, exc)
            self._send(400, {"error": str(exc), "request_id": request_id})
        except Exception:  # noqa: BLE001 - log the traceback, return 500
            log.error("checkout %s failed\n%s", request_id, traceback.format_exc())
            self._send(500, {"error": "internal error", "request_id": request_id})


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s", stream=sys.stdout)
    try:
        cfg = config_module.load()
    except config_module.ConfigError as exc:
        log.critical("invalid configuration, refusing to start: %s", exc)
        sys.exit(1)
    STATE["config"] = cfg
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    log.info("listening on %s, version %s", port, os.environ.get("APP_VERSION", "dev"))
    if cfg["cache_warm_mb"]:
        log.info("warming product image cache: %s MiB", cfg["cache_warm_mb"])
        STATE["cache"] = warm_cache(cfg["cache_warm_mb"])
        log.info("cache warm")
    STATE["ready"] = True
    threading.Event().wait()


if __name__ == "__main__":
    main()
