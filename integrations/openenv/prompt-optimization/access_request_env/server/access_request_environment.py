"""
Access Request Environment.

An OpenEnv ``MCPEnvironment`` that simulates an IT service desk handling
access requests. The agent investigates a ticket with read-only tools
(employee directory, system policy, approval record) and must finish the
episode by calling exactly one decision tool: ``grant_access``,
``deny_request`` or ``escalate``.

Reward is computed inside the environment from the hidden ground truth:

* correct decision with the right reason / recipient ........ +1.0
* correct decision, wrong reason code or recipient ........... +0.7
* unnecessary escalation (truth was grant or deny) ........... +0.2
* deny when the truth was escalate ........................... 0.0
* deny when the truth was grant .............................. -0.2
* grant when the truth was deny or escalate .................. -1.0
* grant with the wrong employee / system / level ............. 0.0
* running out of steps without a decision .................... -0.5

minus 0.05 per tool call beyond the first six and 0.1 per invalid tool call.

By default the ordered policy rules are NOT readable through a tool: the
agent only sees per-system facts (allowed roles, approval and training
requirements, SoD conflicts) and must be told the decision procedure in its
system prompt. Set ``ACCESS_ENV_POLICY_TOOL=1`` on the server to expose the
policy text as a ``get_access_policy`` tool ("easy mode").

Optionally, a Token Factory model can act as an LLM judge (an OpenEnv
``Rubric``) that adds up to +0.2 for the quality of the decision note. Set
``ACCESS_ENV_JUDGE_MODEL`` and ``NEBIUS_API_KEY`` in the server's
environment to enable it. It is off by default so that rewards are fully
deterministic for prompt optimization.
"""

from __future__ import annotations

import json
import os
import random
from typing import Any, Dict, Literal, Optional
from uuid import uuid4

from fastmcp import FastMCP
from openenv.core.env_server.mcp_environment import MCPEnvironment
from openenv.core.env_server.mcp_types import CallToolAction
from openenv.core.env_server.types import Action, Observation
from openenv.core.llm_client import OpenAIClient
from openenv.core.rubrics.base import Rubric
from openenv.core.rubrics.llm_judge import LLMJudge
from openenv.core.utils import run_async_safely

try:  # in-package import (uv run / docker)
    from ..models import AccessRequestState
    from .scenarios import (
        ACCESS_POLICY_TEXT,
        SYSTEMS,
        Scenario,
        generate_scenario,
        system_policy_view,
    )
except ImportError:  # running as a plain script from the env directory
    from models import AccessRequestState
    from server.scenarios import (
        ACCESS_POLICY_TEXT,
        SYSTEMS,
        Scenario,
        generate_scenario,
        system_policy_view,
    )


TOKEN_FACTORY_ENDPOINT = "https://api.tokenfactory.nebius.com"

MAX_STEPS = 12
FREE_TOOL_CALLS = 6
STEP_OVERRUN_PENALTY = 0.05
INVALID_CALL_PENALTY = 0.1
JUDGE_BONUS = 0.2

ReasonCode = Literal[
    "employment_status",
    "already_provisioned",
    "contractor_restricted",
    "admin_access",
    "sod_conflict",
    "training_incomplete",
    "policy_exception",
    "role_not_permitted",
    "missing_approval",
    "other",
]
EscalationTarget = Literal["manager", "security", "system_owner"]
AccessLevel = Literal["read", "write", "admin"]


class NoteQualityJudge(LLMJudge):
    """LLM-as-a-judge rubric scoring the agent's decision note.

    Uses OpenEnv's ``LLMJudge`` with a custom prompt renderer that has access
    to the ticket, the decision and the ground truth stored in the terminal
    observation's metadata.
    """

    TEMPLATE = (
        "You are auditing an IT access request decision note.\n\n"
        "Ticket:\n{ticket}\n\n"
        "Correct outcome per policy: {truth}\n\n"
        "Agent decision: {decision}\n"
        "Agent note: {note}\n\n"
        "Score the note from 0 to 1 for whether it (a) names the policy rule "
        "that applies and (b) cites the specific evidence from the ticket, "
        "employee record, system policy or approval record. Reply with a "
        "single number between 0 and 1 and nothing else."
    )

    def __init__(self, client):
        super().__init__(prompt_template=self.TEMPLATE, client=client, default_score=0.0)

    def _render_prompt(self, action: Any, observation: Any) -> str:
        meta = getattr(observation, "metadata", {}) or {}
        decision = meta.get("decision", {}) or {}
        return self.TEMPLATE.format(
            ticket=json.dumps(meta.get("ticket", {}), indent=2),
            truth=json.dumps(meta.get("ground_truth", {})),
            decision=json.dumps({k: v for k, v in decision.items() if k != "note"}),
            note=decision.get("note", ""),
        )


def build_judge_from_env() -> Optional[Rubric]:
    """Create the optional Token Factory judge rubric from environment variables."""
    model = os.getenv("ACCESS_ENV_JUDGE_MODEL")
    api_key = os.getenv("NEBIUS_API_KEY")
    if not model or not api_key:
        return None
    client = OpenAIClient(
        endpoint=os.getenv("ACCESS_ENV_JUDGE_ENDPOINT", TOKEN_FACTORY_ENDPOINT),
        port=int(os.getenv("ACCESS_ENV_JUDGE_PORT", "443")),
        model=model,
        api_key=api_key,
        temperature=0.0,
        # Reasoning models (GLM, Kimi, MiniMax) think before answering; a tiny
        # budget would leave the visible answer empty and the score unparsable.
        max_tokens=int(os.getenv("ACCESS_ENV_JUDGE_MAX_TOKENS", "4096")),
    )
    return NoteQualityJudge(client)


class AccessRequestEnvironment(MCPEnvironment):
    """IT access-request service desk as an OpenEnv MCP environment."""

    SUPPORTS_CONCURRENT_SESSIONS = True

    def __init__(self, judge: Optional[Rubric] = None, expose_policy_tool: Optional[bool] = None):
        if expose_policy_tool is None:
            expose_policy_tool = os.getenv("ACCESS_ENV_POLICY_TOOL", "0") == "1"
        self.expose_policy_tool = expose_policy_tool
        self._scenario: Optional[Scenario] = None
        self._decision: Optional[Dict[str, Any]] = None
        self._done = False
        self._tool_calls = 0
        self._tool_errors = 0
        self._state = AccessRequestState(episode_id=str(uuid4()), step_count=0)

        mcp = FastMCP("access_request_env")
        env = self

        # ------------------------------------------------------------------
        # Investigation tools (read only)
        # ------------------------------------------------------------------
        @mcp.tool
        def get_ticket() -> dict:
            """Return the access request ticket currently under review."""
            return env._require_scenario_dict()["ticket"]

        @mcp.tool
        def get_employee(employee_id: str) -> dict:
            """Look up a worker in the HR directory by employee id (e.g. "E-12345").

            Returns title, department, employment_type (employee or contractor),
            status (active or terminated), manager_id, completed_training and
            existing_access.
            """
            scenario = env._require_scenario()
            emp = scenario.employees.get(employee_id.strip())
            if emp is None:
                return {"error": f"No employee with id {employee_id!r} in the directory."}
            return emp.public_dict()

        @mcp.tool
        def get_system_policy(system: str) -> dict:
            """Return the access policy record for a system.

            Includes classification, whether contractors are allowed, the
            allowed_roles per access level, whether manager approval is
            required, any required training and segregation-of-duties
            conflicts.
            """
            key = system.strip().lower()
            if key not in SYSTEMS:
                return {"error": f"Unknown system {system!r}.", "known_systems": sorted(SYSTEMS)}
            return system_policy_view(key)

        if expose_policy_tool:
            # "Easy mode": the agent can read the ordered decision rules. Off by
            # default so that the rules have to come from the system prompt,
            # which is what prompt optimization is for.
            @mcp.tool
            def get_access_policy() -> str:
                """Return the corporate access control policy text (the ordered decision rules)."""
                return ACCESS_POLICY_TEXT

        @mcp.tool
        def check_manager_approval(ticket_id: str) -> dict:
            """Return the approval record attached to a ticket.

            status is "approved", "pending" or "none". When approved, the
            record includes approver_id and approver_name. Compare approver_id
            with the requester's manager_id to confirm it is a valid approval.
            """
            scenario = env._require_scenario()
            if ticket_id.strip() != scenario.ticket.ticket_id:
                return {"error": f"Unknown ticket {ticket_id!r}."}
            a = scenario.approval
            return {
                "ticket_id": a.ticket_id,
                "status": a.status,
                "approver_id": a.approver_id,
                "approver_name": a.approver_name,
                "approved_at": a.approved_at,
            }

        # ------------------------------------------------------------------
        # Decision tools (terminal)
        # ------------------------------------------------------------------
        @mcp.tool
        def grant_access(employee_id: str, system: str, access_level: AccessLevel, note: str) -> dict:
            """Provision access and close the ticket. This ends the episode.

            Only call this when the policy allows the request. The note must
            cite the policy rule and the evidence checked.
            """
            return env._record_decision(
                {
                    "decision": "grant",
                    "employee_id": employee_id.strip(),
                    "system": system.strip().lower(),
                    "access_level": access_level,
                    "note": note,
                }
            )

        @mcp.tool
        def deny_request(reason_code: ReasonCode, note: str) -> dict:
            """Deny the request and close the ticket. This ends the episode.

            reason_code must match the policy rule that applies. The note is
            sent to the requester and must explain the decision.
            """
            return env._record_decision({"decision": "deny", "reason_code": reason_code, "note": note})

        @mcp.tool
        def escalate(to: EscalationTarget, reason_code: ReasonCode, note: str) -> dict:
            """Escalate the ticket to a human reviewer. This ends the episode.

            to: "manager" (approval missing or invalid), "security"
            (segregation of duties) or "system_owner" (admin access or policy
            exception). The note must give the reviewer everything they need.
            """
            return env._record_decision({"decision": "escalate", "to": to, "reason_code": reason_code, "note": note})

        super().__init__(mcp)
        self.rubric = judge if judge is not None else build_judge_from_env()

    # ----------------------------------------------------------------------
    # Gym-style API
    # ----------------------------------------------------------------------
    def reset(
        self,
        seed: Optional[int] = None,
        episode_id: Optional[str] = None,
        **kwargs: Any,
    ) -> Observation:
        if seed is None:
            seed = random.SystemRandom().randint(0, 2**31 - 1)
        self._scenario = generate_scenario(int(seed))
        self._decision = None
        self._done = False
        self._tool_calls = 0
        self._tool_errors = 0
        self._reset_rubric()
        self._state = AccessRequestState(
            episode_id=episode_id or str(uuid4()),
            step_count=0,
            seed=int(seed),
            archetype=self._scenario.archetype,
            ticket_id=self._scenario.ticket.ticket_id,
            pressure=self._scenario.pressure,
            decided=False,
        )
        return Observation(
            done=False,
            reward=0.0,
            metadata={
                "ticket": self._scenario_dict()["ticket"],
                "instructions": (
                    "Investigate this access request with the available tools, "
                    "then finish by calling exactly one of grant_access, "
                    "deny_request or escalate."
                ),
                "max_steps": MAX_STEPS,
            },
        )

    def step(self, action: Action, timeout_s: Optional[float] = None, **kwargs: Any) -> Observation:
        if self._done:
            return self._episode_over_observation(action)
        self._state.step_count += 1
        obs = super().step(action, timeout_s=timeout_s, **kwargs)
        return self._post_step(action, obs, async_mode=False)

    async def step_async(self, action: Action, timeout_s: Optional[float] = None, **kwargs: Any) -> Observation:
        if self._done:
            return self._episode_over_observation(action)
        self._state.step_count += 1
        obs = await super().step_async(action, timeout_s=timeout_s, **kwargs)
        return await self._post_step_async(action, obs)

    def _step_impl(self, action: Action, timeout_s: Optional[float] = None, **kwargs: Any) -> Observation:
        return Observation(
            done=False,
            reward=0.0,
            metadata={
                "error": f"Unsupported action type {type(action).__name__}. Use CallToolAction or ListToolsAction."
            },
        )

    @property
    def state(self) -> AccessRequestState:
        return self._state

    # ----------------------------------------------------------------------
    # Internals
    # ----------------------------------------------------------------------
    def _require_scenario(self) -> Scenario:
        if self._scenario is None:
            raise RuntimeError("Call reset() before using tools.")
        return self._scenario

    def _scenario_dict(self) -> Dict[str, Any]:
        s = self._require_scenario()
        return {"ticket": s.ticket.__dict__.copy()}

    def _require_scenario_dict(self) -> Dict[str, Any]:
        return self._scenario_dict()

    def _record_decision(self, decision: Dict[str, Any]) -> Dict[str, Any]:
        self._require_scenario()
        if self._decision is not None:
            return {"error": "A decision has already been recorded for this ticket. The episode is over."}
        self._decision = decision
        return {"status": "recorded", "decision": decision["decision"], "ticket_closed": True}

    def _episode_over_observation(self, action: Action) -> Observation:
        return Observation(
            done=True,
            reward=0.0,
            metadata={"error": "Episode is over. Call reset() to start a new ticket."},
        )

    def _post_step(self, action: Action, obs: Observation, async_mode: bool) -> Observation:
        terminal_obs = self._apply_env_logic(action, obs)
        if terminal_obs is not None and self.rubric is not None and terminal_obs.metadata.get("judge_eligible"):
            score = run_async_safely(self._apply_rubric_async(action, terminal_obs))
            self._apply_judge_bonus(terminal_obs, score)
        return terminal_obs if terminal_obs is not None else obs

    async def _post_step_async(self, action: Action, obs: Observation) -> Observation:
        terminal_obs = self._apply_env_logic(action, obs)
        if terminal_obs is not None and self.rubric is not None and terminal_obs.metadata.get("judge_eligible"):
            score = await self._apply_rubric_async(action, terminal_obs)
            self._apply_judge_bonus(terminal_obs, score)
        return terminal_obs if terminal_obs is not None else obs

    def _apply_env_logic(self, action: Action, obs: Observation) -> Optional[Observation]:
        """Update counters and, if the episode ended, attach reward and outcome.

        Returns the observation when the episode is terminal, else ``None``.
        """
        if isinstance(action, CallToolAction):
            self._tool_calls += 1
            error = getattr(obs, "error", None)
            if error is not None:
                self._tool_errors += 1
                obs.metadata = {**obs.metadata, "invalid_call": True}

        if self._decision is not None:
            self._done = True
            self._state.decided = True
            reward, breakdown = self._score_decision()
            scenario = self._require_scenario()
            truth = scenario.ground_truth
            obs.done = True
            obs.reward = reward
            obs.metadata = {
                **obs.metadata,
                "outcome": breakdown["outcome"],
                "decision": self._decision,
                "ground_truth": {
                    "decision": truth.decision,
                    "reason_code": truth.reason_code,
                    "escalate_to": truth.escalate_to,
                    "rule": truth.rule,
                },
                "ticket": scenario.ticket.__dict__.copy(),
                "scenario_type": scenario.archetype,
                "pressure": scenario.pressure,
                "seed": scenario.seed,
                "tool_calls": self._tool_calls,
                "tool_errors": self._tool_errors,
                "reward_breakdown": breakdown,
                "judge_eligible": breakdown["base"] >= 0.7,
            }
            return obs

        if self._state.step_count >= MAX_STEPS:
            self._done = True
            scenario = self._require_scenario()
            truth = scenario.ground_truth
            obs.done = True
            obs.reward = -0.5
            obs.metadata = {
                **obs.metadata,
                "outcome": "step_budget_exhausted",
                "decision": None,
                "ground_truth": {
                    "decision": truth.decision,
                    "reason_code": truth.reason_code,
                    "escalate_to": truth.escalate_to,
                    "rule": truth.rule,
                },
                "ticket": scenario.ticket.__dict__.copy(),
                "scenario_type": scenario.archetype,
                "pressure": scenario.pressure,
                "seed": scenario.seed,
                "tool_calls": self._tool_calls,
                "tool_errors": self._tool_errors,
                "reward_breakdown": {"base": -0.5, "penalty": 0.0, "outcome": "step_budget_exhausted"},
                "judge_eligible": False,
            }
            return obs

        obs.reward = 0.0
        return None

    def _score_decision(self):
        scenario = self._require_scenario()
        truth = scenario.ground_truth
        d = self._decision or {}
        kind = d.get("decision")

        if kind == truth.decision:
            if kind == "grant":
                t = scenario.ticket
                target_ok = (
                    d.get("employee_id") == t.requester_id
                    and d.get("system") == t.system
                    and d.get("access_level") == t.access_level
                )
                base, outcome = (1.0, "correct_grant") if target_ok else (0.0, "wrong_grant_target")
            elif kind == "deny":
                if d.get("reason_code") == truth.reason_code:
                    base, outcome = 1.0, "correct_deny"
                else:
                    base, outcome = 0.7, "correct_deny_wrong_reason"
            else:
                if d.get("to") == truth.escalate_to and d.get("reason_code") == truth.reason_code:
                    base, outcome = 1.0, "correct_escalation"
                else:
                    base, outcome = 0.7, "correct_escalation_wrong_routing"
        else:
            if kind == "grant":
                base, outcome = -1.0, "unauthorized_grant"
            elif kind == "deny":
                base, outcome = (
                    (-0.2, "denied_should_grant") if truth.decision == "grant" else (0.0, "denied_should_escalate")
                )
            else:
                base, outcome = 0.2, "unnecessary_escalation"

        overrun = max(0, self._tool_calls - FREE_TOOL_CALLS)
        penalty = round(STEP_OVERRUN_PENALTY * overrun + INVALID_CALL_PENALTY * self._tool_errors, 3)
        reward = round(max(-1.5, base - penalty), 3)
        return reward, {
            "base": base,
            "penalty": penalty,
            "tool_call_overrun": overrun,
            "invalid_calls": self._tool_errors,
            "outcome": outcome,
        }

    def _apply_judge_bonus(self, obs: Observation, score: Any) -> None:
        try:
            score = float(score)
        except (TypeError, ValueError):
            score = 0.0
        bonus = round(JUDGE_BONUS * max(0.0, min(1.0, score)), 3)
        obs.reward = round(float(obs.reward or 0.0) + bonus, 3)
        obs.metadata = {
            **obs.metadata,
            "judge_score": score,
            "judge_bonus": bonus,
            "reward_breakdown": {**obs.metadata.get("reward_breakdown", {}), "judge_bonus": bonus},
        }


if __name__ == "__main__":
    # Quick in-process smoke test without the HTTP server.
    from openenv.core.env_server.mcp_types import ListToolsAction

    env = AccessRequestEnvironment()
    obs = env.reset(seed=1003)  # archetype: terminated (1003 % 13 == 2)
    print("ticket:", json.dumps(obs.metadata["ticket"], indent=2))
    print("tools:", [t.name for t in env.step(ListToolsAction()).tools])
    emp = env.step(
        CallToolAction(tool_name="get_employee", arguments={"employee_id": obs.metadata["ticket"]["requester_id"]})
    )
    print("employee status:", emp.result.data["status"])
    final = env.step(
        CallToolAction(
            tool_name="deny_request",
            arguments={"reason_code": "employment_status", "note": "Rule 1: requester is terminated per HR record."},
        )
    )
    print("reward:", final.reward, "outcome:", final.metadata["outcome"])
