"""Controlled load: a steady trickle of checkout requests. Usage: python -m storefront.load URL [--rps 2] [--seconds 30]"""
from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request

ORDERS = [
    {"items": [{"sku": "MUG-01", "qty": 2}]},
    {"items": [{"sku": "TEE-02", "qty": 1}, {"sku": "STK-04", "qty": 3}], "coupon": "SAVE10"},
    {"items": [{"sku": "CAP-03", "qty": 12}]},
]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("url")
    parser.add_argument("--rps", type=float, default=2.0)
    parser.add_argument("--seconds", type=int, default=30)
    args = parser.parse_args()
    deadline = time.monotonic() + args.seconds
    counts: dict[str, int] = {}
    i = 0
    while time.monotonic() < deadline:
        order = ORDERS[i % len(ORDERS)]
        req = urllib.request.Request(f"{args.url.rstrip('/')}/api/checkout", data=json.dumps(order).encode(),
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                key = str(resp.status)
        except urllib.error.HTTPError as exc:
            key = str(exc.code)
        except OSError as exc:
            key = type(exc).__name__
        counts[key] = counts.get(key, 0) + 1
        i += 1
        time.sleep(1 / args.rps)
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
