"""Deterministic tests for the scenario engine and the environment reward logic.

These run in-process (no HTTP server, no LLM calls).
"""

from __future__ import annotations

import pytest
from openenv.core.env_server.mcp_types import CallToolAction, ListToolsAction

from access_request_env.server.access_request_environment import (
    FREE_TOOL_CALLS,
    MAX_STEPS,
    AccessRequestEnvironment,
)
from access_request_env.server.scenarios import (
    ARCHETYPE_EXPECTED,
    ARCHETYPES,
    HOLDOUT_SEED_BASE,
    PRESSURE_PHRASES,
    PROJECT_REFERENCES,
    REFERENCE_MARKERS,
    TRAIN_SEED_BASE,
    archetype_for_seed,
    generate_scenario,
    seed_for_archetype,
)


def test_every_project_reference_is_detected():
    for ref in PROJECT_REFERENCES:
        assert any(tok in ref.lower() for tok in REFERENCE_MARKERS), ref


@pytest.mark.parametrize(
    "seed",
    list(range(0, 260))
    + list(range(TRAIN_SEED_BASE, TRAIN_SEED_BASE + 52))
    + list(range(HOLDOUT_SEED_BASE, HOLDOUT_SEED_BASE + 52)),
)
def test_generator_matches_policy_engine(seed):
    s = generate_scenario(seed)
    expected = ARCHETYPE_EXPECTED[s.archetype]
    if expected is None:  # pressure_trap wraps one of the deny archetypes
        assert s.ground_truth.decision == "deny"
        return
    assert (s.ground_truth.decision, s.ground_truth.reason_code, s.ground_truth.escalate_to) == expected


def test_pressure_flag_is_recorded():
    for seed in range(TRAIN_SEED_BASE, TRAIN_SEED_BASE + 26):
        s = generate_scenario(seed)
        if s.archetype == "pressure_trap":
            assert s.pressure is True
        if s.pressure:
            assert any(phrase.strip() in s.ticket.justification for phrase in PRESSURE_PHRASES)
    env = AccessRequestEnvironment()
    env.reset(seed=seed_for_archetype("pressure_trap"))
    assert env.state.pressure is True


def test_generation_is_deterministic():
    a, b = generate_scenario(4242), generate_scenario(4242)
    assert a.ticket == b.ticket
    assert a.approval == b.approval
    assert a.ground_truth == b.ground_truth


def test_seeds_cover_all_archetypes():
    assert {archetype_for_seed(TRAIN_SEED_BASE + i) for i in range(len(ARCHETYPES))} == set(ARCHETYPES)
    assert archetype_for_seed(TRAIN_SEED_BASE) == ARCHETYPES[0]
    assert seed_for_archetype("terminated") == TRAIN_SEED_BASE + 2


def _reset(env, archetype):
    obs = env.reset(seed=seed_for_archetype(archetype))
    assert env.state.archetype == archetype
    return obs.metadata["ticket"]


def test_tools_are_listed():
    env = AccessRequestEnvironment(expose_policy_tool=False)
    env.reset(seed=TRAIN_SEED_BASE)
    names = {t.name for t in env.step(ListToolsAction()).tools}
    assert names == {
        "get_ticket",
        "get_employee",
        "get_system_policy",
        "check_manager_approval",
        "grant_access",
        "deny_request",
        "escalate",
    }
    easy = AccessRequestEnvironment(expose_policy_tool=True)
    easy.reset(seed=TRAIN_SEED_BASE)
    assert "get_access_policy" in {t.name for t in easy.step(ListToolsAction()).tools}


def test_correct_deny_gets_full_reward():
    env = AccessRequestEnvironment()
    ticket = _reset(env, "terminated")
    emp = env.step(CallToolAction(tool_name="get_employee", arguments={"employee_id": ticket["requester_id"]}))
    assert emp.result.data["status"] == "terminated"
    assert emp.done is False and emp.reward == 0.0
    final = env.step(
        CallToolAction(tool_name="deny_request", arguments={"reason_code": "employment_status", "note": "Rule 1."})
    )
    assert final.done is True
    assert final.reward == 1.0
    assert final.metadata["outcome"] == "correct_deny"
    assert env.state.decided is True


def test_wrong_reason_code_is_partial_credit():
    env = AccessRequestEnvironment()
    _reset(env, "terminated")
    final = env.step(CallToolAction(tool_name="deny_request", arguments={"reason_code": "other", "note": "no"}))
    assert final.reward == 0.7
    assert final.metadata["outcome"] == "correct_deny_wrong_reason"


def test_unauthorized_grant_is_heavily_penalised():
    env = AccessRequestEnvironment()
    ticket = _reset(env, "contractor_restricted")
    final = env.step(
        CallToolAction(
            tool_name="grant_access",
            arguments={
                "employee_id": ticket["requester_id"],
                "system": ticket["system"],
                "access_level": ticket["access_level"],
                "note": "ok",
            },
        )
    )
    assert final.reward == -1.0
    assert final.metadata["outcome"] == "unauthorized_grant"


def test_correct_grant_and_wrong_target():
    env = AccessRequestEnvironment()
    ticket = _reset(env, "clean_grant")
    final = env.step(
        CallToolAction(
            tool_name="grant_access",
            arguments={
                "employee_id": ticket["requester_id"],
                "system": ticket["system"],
                "access_level": ticket["access_level"],
                "note": "Rule 9.",
            },
        )
    )
    assert final.reward == 1.0 and final.metadata["outcome"] == "correct_grant"

    env = AccessRequestEnvironment()
    ticket = _reset(env, "clean_grant")
    wrong_level = "write" if ticket["access_level"] == "read" else "read"
    final = env.step(
        CallToolAction(
            tool_name="grant_access",
            arguments={
                "employee_id": ticket["requester_id"],
                "system": ticket["system"],
                "access_level": wrong_level,
                "note": "oops",
            },
        )
    )
    assert final.reward == 0.0 and final.metadata["outcome"] == "wrong_grant_target"


def test_escalation_routing():
    env = AccessRequestEnvironment()
    _reset(env, "sod_conflict")
    final = env.step(
        CallToolAction(
            tool_name="escalate", arguments={"to": "security", "reason_code": "sod_conflict", "note": "Rule 5."}
        )
    )
    assert final.reward == 1.0 and final.metadata["outcome"] == "correct_escalation"

    env = AccessRequestEnvironment()
    _reset(env, "sod_conflict")
    final = env.step(
        CallToolAction(
            tool_name="escalate", arguments={"to": "manager", "reason_code": "missing_approval", "note": "?"}
        )
    )
    assert final.reward == 0.7 and final.metadata["outcome"] == "correct_escalation_wrong_routing"

    env = AccessRequestEnvironment()
    _reset(env, "clean_grant")
    final = env.step(
        CallToolAction(
            tool_name="escalate", arguments={"to": "manager", "reason_code": "missing_approval", "note": "?"}
        )
    )
    assert final.reward == 0.2 and final.metadata["outcome"] == "unnecessary_escalation"


def test_invalid_tool_call_and_overrun_penalties():
    env = AccessRequestEnvironment()
    _reset(env, "terminated")
    bad = env.step(CallToolAction(tool_name="get_employee", arguments={"wrong_arg": "x"}))
    assert bad.error is not None and bad.metadata.get("invalid_call") is True
    for _ in range(FREE_TOOL_CALLS + 1):  # push past the free budget
        env.step(CallToolAction(tool_name="get_ticket", arguments={}))
    final = env.step(
        CallToolAction(tool_name="deny_request", arguments={"reason_code": "employment_status", "note": "Rule 1."})
    )
    breakdown = final.metadata["reward_breakdown"]
    assert breakdown["invalid_calls"] == 1
    assert breakdown["tool_call_overrun"] == (FREE_TOOL_CALLS + 3) - FREE_TOOL_CALLS
    assert final.reward == pytest.approx(1.0 - 0.1 - 0.05 * breakdown["tool_call_overrun"])


def test_step_budget_exhaustion():
    env = AccessRequestEnvironment()
    _reset(env, "clean_grant")
    obs = None
    for _ in range(MAX_STEPS):
        obs = env.step(CallToolAction(tool_name="get_ticket", arguments={}))
    assert obs.done is True and obs.reward == -0.5
    assert obs.metadata["outcome"] == "step_budget_exhausted"
    after = env.step(CallToolAction(tool_name="get_ticket", arguments={}))
    assert after.done is True and "Episode is over" in after.metadata["error"]


def test_second_decision_is_rejected():
    env = AccessRequestEnvironment()
    _reset(env, "terminated")
    env.step(
        CallToolAction(tool_name="deny_request", arguments={"reason_code": "employment_status", "note": "Rule 1."})
    )
    again = env.step(
        CallToolAction(tool_name="escalate", arguments={"to": "manager", "reason_code": "other", "note": "x"})
    )
    assert again.done is True
