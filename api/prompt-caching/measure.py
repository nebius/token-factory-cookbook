"""Measure prompt caching on Nebius Token Factory.

Phase 1 sends one warm-up call and then several questions that share a long
prefix, printing cached tokens, latency and list-price cost per call.
Phase 2 shows what a timestamp in the system prompt does to the cache.
Phase 3 prints the cached-input discount of every model in the public catalog.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
from dataclasses import dataclass

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
DEFAULT_MODEL = "zai-org/GLM-5.3-Flash"
DEFAULT_CATALOG_URL = "https://tokenfactory.nebius.com/api/public/models_info"
SENTENCE = (
    "The Northwind parts catalog lists item {i} with its unit price, warehouse shelf, "
    "supplier code, reorder point and preferred shipping lane. "
)


class CatalogError(Exception):
    """The public model catalog could not be read."""


@dataclass
class CallResult:
    prompt_tokens: int
    cached_tokens: int
    completion_tokens: int
    seconds: float
    answer: str

    @property
    def hit(self) -> bool:
        return self.cached_tokens > 0


@dataclass
class Prices:
    """USD per 1M tokens."""

    input: float
    cached: float
    output: float


@dataclass
class Summary:
    calls: int
    hits: int
    cached_tokens: int
    cost_usd: float
    uncached_cost_usd: float


def build_document(paragraphs: int) -> str:
    """A deterministic document: same input, same bytes, every run."""
    return "\n".join(f"Paragraph {i}: " + SENTENCE.format(i=i) * 3 for i in range(paragraphs))


def system_prompt(document: str) -> str:
    return "You answer briefly from the document.\n\nDOCUMENT:\n" + document


def questions(n: int, paragraphs: int) -> list[str]:
    """n questions spread across the document; the first one is the warm-up question."""
    return [f"What is paragraph {i * paragraphs // n} about?" for i in range(n)]


def parse_catalog(data: list[dict]) -> list[dict]:
    """One row per live flavor that has a cached price."""
    rows = []
    for model in data:
        for flavor in model.get("flavors", []):
            cached = flavor.get("input_cached_price_per_million_tokens")
            if flavor.get("deprecated") or cached is None:
                continue
            rows.append(
                {
                    "model_id": flavor["model_id"],
                    "input": float(flavor["input_price_per_million_tokens"]),
                    "cached": float(cached),
                    "output": float(flavor["output_price_per_million_tokens"]),
                }
            )
    return rows


def fetch_catalog(url: str, timeout: float = 10) -> list[dict]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            data = json.load(response)
    except (OSError, ValueError) as exc:
        raise CatalogError(f"could not read {url}: {exc}") from exc
    return parse_catalog(data)


def price_of(catalog: list[dict], model: str) -> Prices:
    for row in catalog:
        if row["model_id"] == model:
            return Prices(row["input"], row["cached"], row["output"])
    raise KeyError(model)


def prices_from_env(env: dict) -> Prices | None:
    keys = ("NEBIUS_INPUT_PRICE", "NEBIUS_CACHED_PRICE", "NEBIUS_OUTPUT_PRICE")
    if not all(key in env for key in keys):
        return None
    return Prices(*(float(env[key]) for key in keys))


def cost(result: CallResult, prices: Prices) -> float:
    uncached = result.prompt_tokens - result.cached_tokens
    total = uncached * prices.input + result.cached_tokens * prices.cached + result.completion_tokens * prices.output
    return total / 1_000_000


def uncached_cost(result: CallResult, prices: Prices) -> float:
    total = result.prompt_tokens * prices.input + result.completion_tokens * prices.output
    return total / 1_000_000


def summarize(results: list[CallResult], prices: Prices) -> Summary:
    return Summary(
        calls=len(results),
        hits=sum(1 for r in results if r.hit),
        cached_tokens=sum(r.cached_tokens for r in results),
        cost_usd=sum(cost(r, prices) for r in results),
        uncached_cost_usd=sum(uncached_cost(r, prices) for r in results),
    )


def break_the_cache(system: str, now: str) -> str:
    """Put something that changes every call in front of the static prefix."""
    return f"Current time: {now}\n" + system


def discount_table(catalog: list[dict]) -> list[tuple[str, float, float, int]]:
    rows = []
    for row in catalog:
        discount = 0 if row["input"] == 0 else round(100 * (1 - row["cached"] / row["input"]))
        rows.append((row["model_id"], row["input"], row["cached"], discount))
    return sorted(rows, key=lambda r: (-r[3], r[0]))
