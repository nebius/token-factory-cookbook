"""Load and validate the storefront configuration. The schema is in docs/config.md."""
from __future__ import annotations

import json
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path

from .pricing import PricingConfig

DEFAULT_PATH = "/etc/storefront/config.json"


class ConfigError(Exception):
    """The configuration file is missing or invalid. The server refuses to start."""


def _decimal(raw: dict, key: str, low: str, high: str) -> Decimal:
    value = raw.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise ConfigError(f"{key}: expected a number, got {value!r}")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise ConfigError(f"{key}: expected a number, got {value!r}") from exc
    if not (Decimal(low) <= number <= Decimal(high)):
        raise ConfigError(f"{key}: {number} is outside the allowed range {low}..{high}")
    return number


def load(path: str | None = None) -> dict:
    path = path or os.environ.get("STOREFRONT_CONFIG", DEFAULT_PATH)
    try:
        raw = json.loads(Path(path).read_text())
    except FileNotFoundError as exc:
        raise ConfigError(f"config file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise ConfigError(f"config file is not valid JSON: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError("config must be a JSON object")
    currency = raw.get("currency")
    if not (isinstance(currency, str) and len(currency) == 3 and currency.isupper()):
        raise ConfigError(f"currency: expected a 3-letter ISO code such as USD, got {currency!r}")
    cache_warm_mb = raw.get("cache_warm_mb", 0)
    if isinstance(cache_warm_mb, bool) or not isinstance(cache_warm_mb, int) or not 0 <= cache_warm_mb <= 256:
        raise ConfigError(f"cache_warm_mb: expected an integer from 0 to 256, got {cache_warm_mb!r}")
    gateway = raw.get("payment_gateway_url", "")
    if not isinstance(gateway, str):
        raise ConfigError("payment_gateway_url: expected a string")
    pricing = PricingConfig(
        currency=currency,
        tax_rate=_decimal(raw, "tax_rate", "0", "0.5"),
        shipping_flat=_decimal(raw, "shipping_flat", "0", "100"),
        free_shipping_threshold=_decimal(raw, "free_shipping_threshold", "0", "100000"),
    )
    return {"pricing": pricing, "cache_warm_mb": cache_warm_mb, "payment_gateway_url": gateway}
