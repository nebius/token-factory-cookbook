"""Run reports in Markdown and JSON, built only from what the run recorded."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any

from kubetrace_agent.llm import FIXTURE_LABEL

PROVENANCE_LABEL = {
    "fixture": "FIXTURE run: scripted test double, no model was called",
    "local-live": "Live run on a local kind cluster",
    "civo-live": "Live run on a Civo cluster",
    "replay": "Replay of an exported run",
    "pending": "Not yet investigated",
}


def load_pricing(path: Path) -> dict:
    try:
        return {p["model"]: p for p in json.loads(path.read_text())["models"]}
    except (OSError, ValueError, KeyError):
        return {}


def cost_estimate(run: dict, pricing: dict) -> dict | None:
    m = run.get("metrics") or {}
    price = pricing.get(run.get("model") or "")
    if not price or m.get("token_usage") != "reported by provider":
        return None
    usd = m["prompt_tokens"] / 1e6 * price["input_per_m"] + m["completion_tokens"] / 1e6 * price["output_per_m"]
    return {"usd": round(usd, 4), "label": "estimate", "rate_source": price["source"], "rate_date": price["date"],
            "input_per_m": price["input_per_m"], "output_per_m": price["output_per_m"],
            "note": "Cached-token discounts, if any, are not applied."}


def mask(value: Any) -> Any:
    """Presentation mode: hide addresses, cluster ids and registry hosts."""
    if isinstance(value, str):
        value = re.sub(r"https?://[\w.-]+(:\d+)?", "https://[hidden]", value)
        value = re.sub(r"\b\d{1,3}(\.\d{1,3}){3}\b", "[ip]", value)
        value = re.sub(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", "[id]", value)
        value = re.sub(r"\bttl\.sh/[\w-]+", "[registry]", value)
        return value
    if isinstance(value, dict):
        return {k: ("[hidden]" if k in ("server", "context") else mask(v)) for k, v in value.items()}
    if isinstance(value, list):
        return [mask(v) for v in value]
    return value


def build(run: dict, events: list[dict], pricing: dict, presentation: bool = False) -> dict:
    by_type: dict[str, list[dict]] = {}
    for e in events:
        by_type.setdefault(e["type"], []).append(e)
    outcome = run.get("outcome") or {}
    first = lambda t: (by_type.get(t) or [{}])[0].get("payload", {})  # noqa: E731
    report = {
        "report_version": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "run_id": run["id"], "scenario_id": run["scenario_id"],
        "provenance": run["provenance"], "provenance_label": PROVENANCE_LABEL.get(run["provenance"], run["provenance"]),
        "replay_of": run.get("replay_of"),
        "provider": run.get("provider"), "model": run.get("model"),
        "is_fixture": run["provenance"] == "fixture" or run.get("replay_of") == "fixture",
        "repo_commit": run.get("repo_commit"), "cluster": run.get("cluster"),
        "settings": run.get("settings"), "policy_mode": run.get("policy_mode"),
        "timing": {"created_at": run.get("created_at"), "started_at": run.get("started_at"), "ended_at": run.get("ended_at"),
                   "agent_elapsed_s": outcome.get("elapsed_s")},
        "final_state": outcome.get("final_state") or run.get("state"), "reason": outcome.get("reason"),
        "first_attempt_success": None if run.get("first_attempt_success") is None else bool(run["first_attempt_success"]),
        "eventual_success": None if run.get("eventual_success") is None else bool(run["eventual_success"]),
        "baseline": first("baseline").get("checks", []),
        "issue": {"incident": first("detected").get("incident"), "symptom": first("detected").get("symptom"),
                  "fault_proof": first("detected").get("fault_proof", [])},
        "observations": [e["payload"] for e in by_type.get("observation", [])],
        "hypotheses": [e["payload"] for e in by_type.get("hypothesis", [])],
        "agent_conclusion": outcome.get("agent"),
        "attempted_changes": outcome.get("mutations", []),
        "source_diff": outcome.get("source_diff", ""),
        "tests": outcome.get("tests", []),
        "builds": outcome.get("builds", []),
        "rollouts": [e["payload"] for e in by_type.get("rollout", [])],
        "verifications": outcome.get("verifications", []),
        "drift": outcome.get("drift", []),
        "metrics": run.get("metrics"),
        "cost": cost_estimate(run, pricing),
        "errors": [e["payload"] for e in by_type.get("error", [])],
        "limitations": _limitations(run, outcome),
    }
    return mask(report) if presentation else report


def _limitations(run: dict, outcome: dict) -> list[str]:
    out = []
    if run["provenance"] == "fixture":
        out.append(f"{FIXTURE_LABEL}. It exercises the pipeline, not a model's ability.")
    if outcome.get("drift"):
        out.append("Source and live state differ on: " + ", ".join(d.get("field", "?") for d in outcome["drift"]))
    failed = [m for m in outcome.get("mutations", []) if m.get("status") in ("denied", "rejected", "stale", "failed")]
    if failed:
        out.append(f"{len(failed)} proposed change(s) were denied, rejected, stale or failed; see attempted changes.")
    for v in outcome.get("verifications", []):
        for c in v.get("checks", []):
            if not c.get("ok"):
                out.append(f"Verification attempt {v.get('attempt')}: {c.get('name')} failed ({c.get('detail')})")
    if (run.get("metrics") or {}).get("reconstructed_from_events"):
        out.append("Metrics and outcome were reconstructed from the recorded events: the headless runner exited before "
                   "saving them (fixed 2026-10-16). Verification results are the recorded ones.")
    if (run.get("metrics") or {}).get("token_usage") != "reported by provider":
        out.append("Token usage was not fully reported by the provider; token figures are incomplete.")
    if (run.get("settings") or {}).get("test_runner") == "subprocess":
        out.append("Tests ran in the subprocess fallback, which is not isolated.")
    return out


def _fmt_check(c: dict) -> str:
    return f"- {'✅' if c.get('ok') else '❌'} **{c.get('name')}**: {c.get('detail', '')}"


def markdown(r: dict) -> str:
    m = r.get("metrics") or {}
    lines = [f"# KubeTrace run {r['run_id']}: {r['scenario_id']}", "",
             f"> **{r['provenance_label']}**" + (f" (replayed; originally {r['replay_of']})" if r.get("replay_of") else ""), "",
             f"**Outcome:** {r['final_state']}. {r.get('reason') or ''}  ",
             f"**First-attempt success:** {r['first_attempt_success']} · **Eventual success:** {r['eventual_success']}  ",
             f"**Provider:** {r.get('provider')} · **Model:** `{r.get('model')}` · **Policy mode:** {r.get('policy_mode')}  ",
             f"**Repository commit:** {r.get('repo_commit')}", ""]
    gs = (r.get("settings") or {}).get("generation_settings")
    if gs:
        lines += [f"**Generation settings:** `{json.dumps(gs)}`  ",
                  f"**Prompt / tool schema versions:** {(r.get('settings') or {}).get('prompt_version')} / "
                  f"{(r.get('settings') or {}).get('tool_schema_version')}", ""]
    c = r.get("cluster") or {}
    lines += ["## Cluster", f"- Kind: {c.get('kind')} · Kubernetes {c.get('kubernetes_version')} · context {c.get('context')}",
              f"- Capacity: {json.dumps((c.get('capacity') or {}).get('allocatable'))}", ""]
    lines += ["## Issue", f"**Incident:** {r['issue'].get('incident')}  ", f"**Symptom:** {r['issue'].get('symptom')}", "",
              "Baseline (healthy, before injection):"] + [_fmt_check(x) for x in r["baseline"]]
    lines += ["", "Fault confirmed before investigation:"] + [_fmt_check(x) for x in r["issue"].get("fault_proof", [])]
    lines += ["", "## Evidence and hypotheses"]
    lines += [f"- *Observation:* {o['text']}" + (f" ({', '.join(o.get('evidence', []))})" if o.get("evidence") else "")
              for o in r["observations"]]
    lines += [f"- *Hypothesis:* {h['text']}" + (f" ({', '.join(h.get('evidence', []))})" if h.get("evidence") else "")
              for h in r["hypotheses"]]
    if r.get("agent_conclusion"):
        a = r["agent_conclusion"]
        lines += ["", f"**Agent conclusion ({a.get('outcome')}):** {a.get('root_cause')}", "", a.get("summary", "")]
    lines += ["", "## Attempted changes"]
    for mu in r["attempted_changes"]:
        lines += [f"### {mu['source']} {mu['kind']}/{mu['name']}: {mu['status']}", f"Reason: {mu['reason']}", ""]
        if mu.get("decision", {}).get("reasons"):
            lines += ["Policy: " + "; ".join(mu["decision"]["reasons"]), ""]
        if mu.get("error"):
            lines += [f"Error: {mu['error']}", ""]
        if mu.get("diff"):
            lines += ["```diff", mu["diff"].rstrip(), "```", ""]
    if not r["attempted_changes"]:
        lines.append("None.")
    if r.get("source_diff"):
        lines += ["", "## Source diff (workspace, from the incident commit)", "```diff", r["source_diff"].rstrip(), "```"]
    lines += ["", "## Tests"]
    for t in r["tests"]:
        lines += [f"### `{t['command']}`: exit {t['exit_code']} ({'passed' if t['passed'] else 'failed'}, {t['duration_s']} s)",
                  f"Isolation: {t['isolation']}", "```", (t.get("output") or "").rstrip()[-3000:], "```"]
    if not r["tests"]:
        lines.append("No tests were run.")
    if r["builds"]:
        lines += ["", "## Images built"] + [f"- `{b['image']}` from commit {b['source_commit'][:10]} ({b['duration_s']} s)"
                                            for b in r["builds"]]
    if r["rollouts"]:
        lines += ["", "## Rollouts"] + [f"- {x['deployment']}: complete={x['complete']} after {x['waited_s']} s "
                                        f"({x['ready']}/{x['replicas']} ready)" for x in r["rollouts"]]
    lines += ["", "## Independent verification"]
    for v in r["verifications"]:
        lines += [f"Attempt {v['attempt']} (agent said {v['agent_outcome']}): {'passed' if v['ok'] else 'failed'}"]
        lines += [_fmt_check(x) for x in v["checks"]] + [""]
    if not r["verifications"]:
        lines.append("Not reached.")
    lines += ["", "## Measurements"]
    if m:
        lines += [f"- Model calls: {m.get('model_calls')} · model time {m.get('model_latency_s')} s",
                  f"- Tokens: {m.get('prompt_tokens')} in / {m.get('completion_tokens')} out / {m.get('total_tokens')} total "
                  f"({m.get('token_usage')})",
                  f"- Tool calls: {m.get('tool_calls')} ({m.get('tool_errors')} errors) · tool time {m.get('tool_time_s')} s",
                  f"- Rejected actions: {m.get('rejected_actions')} · verification attempts {m.get('verification_attempts')}",
                  f"- Agent elapsed: {r['timing'].get('agent_elapsed_s')} s"]
    else:
        lines.append("Unavailable.")
    cost = r.get("cost")
    lines.append(f"- Cost: ${cost['usd']} ({cost['label']}; rates from {cost['rate_source']}, {cost['rate_date']})" if cost
                 else "- Cost: not shown (no verified pricing configured for this model, or token usage unavailable)")
    lines += ["", "## Limitations"] + ([f"- {x}" for x in r["limitations"]] or ["- None recorded."])
    if r["errors"]:
        lines += ["", "## Errors"] + [f"- {e.get('where', '')}: {e.get('message', '')}" for e in r["errors"]]
    return "\n".join(lines) + "\n"
