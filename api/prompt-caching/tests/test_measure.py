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


def _response(prompt, cached, completion=10):
    usage = SimpleNamespace(
        prompt_tokens=prompt,
        completion_tokens=completion,
        prompt_tokens_details=SimpleNamespace(cached_tokens=cached),
    )
    message = SimpleNamespace(content="Paragraph about parts.")
    return SimpleNamespace(choices=[SimpleNamespace(message=message)], usage=usage)


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        return self.responses.pop(0)


def test_main_prints_summary_and_anti_pattern(capsys):
    client = FakeClient([_response(1000, 0), _response(1000, 900), _response(1000, 900), _response(1000, 0)])
    env = {"NEBIUS_MODEL": "test/model", "CACHE_QUESTIONS": "2", "CACHE_PARAGRAPHS": "3"}

    code = measure.main(client=client, catalog=measure.parse_catalog(CATALOG_DATA), now="2026-01-01 00:00:00", env=env)

    out = capsys.readouterr().out
    assert code == 0
    assert len(client.requests) == 4
    assert client.requests[0]["model"] == "test/model"
    assert client.requests[0]["messages"][0]["content"].startswith("You answer briefly")
    assert client.requests[1]["messages"][1]["content"] == client.requests[0]["messages"][1]["content"]
    assert client.requests[3]["messages"][0]["content"].startswith("Current time: 2026-01-01 00:00:00\n")
    assert "model: test/model  prices: in=$1 cached=$0.1 out=$2 per 1M (catalog, 2026-01-01)" in out
    assert "call 0  prompt=1000   cached=0      miss" in out
    assert "(warm-up)" in out
    assert "call 1  prompt=1000   cached=900    hit " in out
    assert "summary: 3 calls, 2 hits, 1800 cached tokens, $0.0014 total vs $0.0031 uncached, 53% saved" in out
    assert "anti-pattern: timestamp in system prompt -> prompt=1000 cached=0 miss" in out
    assert "catalog: cached input discounts (USD per 1M, read live)" in out
    assert "test/model" in out and "90%" in out


def test_main_exits_2_without_prices(capsys):
    client = FakeClient([])
    code = measure.main(client=client, catalog=[], now="2026-01-01 00:00:00", env={"NEBIUS_MODEL": "x/y"})
    assert code == 2
    assert "NEBIUS_INPUT_PRICE" in capsys.readouterr().out
    assert client.requests == []
