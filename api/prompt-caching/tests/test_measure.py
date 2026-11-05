import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import measure  # noqa: E402

CATALOG_DATA = [
    {"flavors": [{"model_id": "test/model", "deprecated": False,
                  "input_price_per_million_tokens": 1.0,
                  "input_cached_price_per_million_tokens": 0.1,
                  "output_price_per_million_tokens": 2.0}]},
    {"flavors": [{"model_id": "test/flat", "deprecated": False,
                  "input_price_per_million_tokens": 0.5,
                  "input_cached_price_per_million_tokens": 0.5,
                  "output_price_per_million_tokens": 1.0}]},
    {"flavors": [{"model_id": "test/old", "deprecated": True,
                  "input_price_per_million_tokens": 9.0,
                  "input_cached_price_per_million_tokens": 0.9,
                  "output_price_per_million_tokens": 9.0}]},
    {"flavors": [{"model_id": "test/embed", "deprecated": False,
                  "input_price_per_million_tokens": 0.01,
                  "input_cached_price_per_million_tokens": None,
                  "output_price_per_million_tokens": 0.0}]},
]

PRICES = measure.Prices(input=1.0, cached=0.1, output=2.0)


def _result(prompt, cached, completion=10, seconds=0.5):
    return measure.CallResult(prompt_tokens=prompt, cached_tokens=cached,
                              completion_tokens=completion, seconds=seconds, answer="ok")


def test_build_document_is_deterministic():
    first = measure.build_document(5)
    second = measure.build_document(5)
    assert first == second
    assert first.count("\n") == 4
    assert first.startswith("Paragraph 0: ")
    assert "Paragraph 4: " in first
    assert measure.questions(2, 400) == ["What is paragraph 0 about?", "What is paragraph 200 about?"]


def test_cost_splits_cached_and_uncached_tokens():
    miss = _result(1000, 0)
    hit = _result(1000, 900)
    assert measure.cost(miss, PRICES) == pytest.approx(0.00102)
    assert measure.cost(hit, PRICES) == pytest.approx(0.00021)
    assert measure.uncached_cost(hit, PRICES) == pytest.approx(0.00102)
    assert hit.hit is True and miss.hit is False


def test_summarize_counts_hits_and_costs():
    summary = measure.summarize([_result(1000, 0), _result(1000, 900), _result(1000, 900)], PRICES)
    assert summary.calls == 3
    assert summary.hits == 2
    assert summary.cached_tokens == 1800
    assert summary.cost_usd == pytest.approx(0.00144)
    assert summary.uncached_cost_usd == pytest.approx(0.00306)


def test_catalog_helpers():
    catalog = measure.parse_catalog(CATALOG_DATA)
    assert [row["model_id"] for row in catalog] == ["test/model", "test/flat"]
    assert measure.price_of(catalog, "test/model") == PRICES
    with pytest.raises(KeyError):
        measure.price_of(catalog, "missing/model")
    assert measure.prices_from_env({}) is None
    assert measure.prices_from_env({"NEBIUS_INPUT_PRICE": "1", "NEBIUS_CACHED_PRICE": "0.1",
                                    "NEBIUS_OUTPUT_PRICE": "2"}) == PRICES
    assert measure.discount_table(catalog) == [("test/model", 1.0, 0.1, 90), ("test/flat", 0.5, 0.5, 0)]
    system = measure.system_prompt("DOC")
    broken = measure.break_the_cache(system, "2026-01-01 00:00:00")
    assert broken == "Current time: 2026-01-01 00:00:00\n" + system
