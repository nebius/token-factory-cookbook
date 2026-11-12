from kubetrace_api import reports

PRICING = {"meta-models/muse-spark-open": {"model": "meta-models/muse-spark-open", "input_per_m": 1.25, "output_per_m": 4.25,
                                           "source": "catalog", "date": "2026-10-16"}}


def run(**kw):
    base = {"id": "r1", "scenario_id": "selector-mismatch", "provenance": "local-live", "model": "meta-models/muse-spark-open",
            "provider": "nebius-token-factory", "state": "resolved", "metrics": {"prompt_tokens": 1_000_000, "completion_tokens": 100_000,
            "total_tokens": 1_100_000, "token_usage": "reported by provider"}, "outcome": {"final_state": "resolved"},
            "cluster": {"server": "https://74.220.23.17:6443", "context": "civo-ctx"}}
    base.update(kw)
    return base


def test_cost_is_an_estimate_only_with_pricing_and_reported_usage():
    c = reports.cost_estimate(run(), PRICING)
    assert c["usd"] == 1.675 and c["label"] == "estimate"
    assert reports.cost_estimate(run(metrics={"token_usage": "unavailable"}), PRICING) is None
    assert reports.cost_estimate(run(model="unknown/model"), PRICING) is None


def test_fixture_runs_are_labelled():
    r = reports.build(run(provenance="fixture", provider="fixture"), [], PRICING)
    assert r["is_fixture"] and "FIXTURE" in r["provenance_label"]
    assert any("FIXTURE" in x for x in r["limitations"])
    assert "FIXTURE" in reports.markdown(r)


def test_presentation_mode_hides_addresses_and_contexts():
    r = reports.build(run(), [], PRICING, presentation=True)
    text = str(r)
    assert "74.220.23.17" not in text and "civo-ctx" not in text
