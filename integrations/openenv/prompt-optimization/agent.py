"""
Token Factory policy for the Access Request environment.

``run_episode`` drives one episode: it resets the environment with a seed,
turns the environment's MCP tool manifest into OpenAI function-calling
schemas, and loops "model picks a tool -> env.step(CallToolAction)" until the
environment reports ``done``. ``run_batch`` runs many seeds in parallel, each
on its own WebSocket session.

Nothing here knows about the reward logic. The environment owns the reward;
the agent only reads it back.
"""

from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence

from dotenv import load_dotenv
from openai import OpenAI

from access_request_env import AccessRequestEnv, CallToolAction, tool_payload
from access_request_env.server.scenarios import HOLDOUT_SEED_BASE, TRAIN_SEED_BASE

load_dotenv()

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
DEFAULT_ENV_URL = os.getenv("ACCESS_ENV_URL", "http://127.0.0.1:8010")
DEFAULT_POLICY_MODEL = os.getenv("POLICY_MODEL", "zai-org/GLM-5.3-Flash")
DEFAULT_REFLECTOR_MODEL = os.getenv("REFLECTOR_MODEL", "moonshotai/Kimi-K3")

HERE = Path(__file__).resolve().parent
PROMPTS_DIR = HERE / "prompts"
RESULTS_DIR = HERE / "results"

DECISION_TOOLS = {"grant_access", "deny_request", "escalate"}
LLM_TIMEOUT_S = float(os.getenv("LLM_TIMEOUT_S", "120"))


def make_llm() -> OpenAI:
    api_key = os.getenv("NEBIUS_API_KEY")
    if not api_key:
        raise RuntimeError("NEBIUS_API_KEY is not set. Copy env.example to .env and add your key.")
    # Per-request timeout + retries so one slow generation cannot stall a whole batch.
    return OpenAI(base_url=TOKEN_FACTORY_BASE_URL, api_key=api_key, timeout=LLM_TIMEOUT_S, max_retries=2)


def load_prompt(name_or_path: str) -> str:
    p = Path(name_or_path)
    if not p.exists():
        p = PROMPTS_DIR / f"{name_or_path}.md"
    return p.read_text().strip()


def train_seeds(n: int = 26) -> List[int]:
    """Seeds used by the optimizer. 1001 % 13 == 0, so 13 consecutive seeds cover every archetype once."""
    return [TRAIN_SEED_BASE + i for i in range(n)]


def holdout_seeds(n: int = 26) -> List[int]:
    """Seeds the optimizer never sees. 5005 % 13 == 0 as well."""
    return [HOLDOUT_SEED_BASE + i for i in range(n)]


def mcp_tools_to_openai(tools) -> List[Dict[str, Any]]:
    """Convert OpenEnv ``Tool`` objects (MCP schema) to OpenAI function tools."""
    out = []
    for t in tools:
        schema = dict(t.input_schema or {"type": "object", "properties": {}})
        schema.setdefault("type", "object")
        schema.pop("title", None)
        out.append(
            {
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": (t.description or "").strip(),
                    "parameters": schema,
                },
            }
        )
    return out


def _compact(value: Any, limit: int = 4000) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= limit else text[:limit] + " ...[truncated]"


@dataclass
class EpisodeResult:
    seed: int
    model: str
    reward: float
    done: bool
    steps: int
    outcome: Optional[str]
    scenario_type: Optional[str]
    decision: Optional[Dict[str, Any]]
    ground_truth: Optional[Dict[str, Any]]
    ticket: Optional[Dict[str, Any]]
    tool_calls: List[Dict[str, Any]] = field(default_factory=list)
    prompt_tokens: int = 0
    completion_tokens: int = 0
    llm_calls: int = 0
    latency_s: float = 0.0
    error: Optional[str] = None
    judge_score: Optional[float] = None
    judge_bonus: Optional[float] = None
    messages: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def correct(self) -> bool:
        return self.outcome is not None and self.outcome.startswith("correct")

    def to_dict(self, include_messages: bool = False, include_trajectory: bool = False) -> Dict[str, Any]:
        """Serialise the episode.

        The default is a compact record (decision, ground truth, reward, counters) that is small enough to commit.
        ``include_trajectory`` adds the tool trace and ticket, ``include_messages`` the full chat transcript.
        """
        d = asdict(self)
        d["correct"] = self.correct
        if not include_messages:
            d.pop("messages", None)
        if not include_trajectory:
            d.pop("tool_calls", None)
            d.pop("ticket", None)
            if d.get("decision"):
                d["decision"] = {k: v for k, v in d["decision"].items() if k != "note"}
        return d


def run_episode(
    system_prompt: str,
    seed: int,
    *,
    model: str = DEFAULT_POLICY_MODEL,
    env_url: str = DEFAULT_ENV_URL,
    llm: Optional[OpenAI] = None,
    temperature: float = 0.0,
    max_llm_calls: int = 14,
    max_tokens: int = 1200,
) -> EpisodeResult:
    """Run one episode with a Token Factory model as the policy."""
    llm = llm or make_llm()
    started = time.time()
    prompt_tokens = completion_tokens = llm_calls = 0
    tool_log: List[Dict[str, Any]] = []
    messages: List[Dict[str, Any]] = []
    final_meta: Dict[str, Any] = {}
    ticket: Optional[Dict[str, Any]] = None
    scenario_type: Optional[str] = None
    reward = 0.0
    done = False
    steps = 0
    error = None

    env = AccessRequestEnv(base_url=env_url, message_timeout_s=120.0).sync()
    try:
        with env:
            result = env.reset(seed=seed)
            ticket = result.observation.metadata["ticket"]
            scenario_type = getattr(env.state(), "archetype", None)
            tools = mcp_tools_to_openai(env.list_tools())

            messages = [
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        "A new access request ticket has been assigned to you.\n\n"
                        f"{json.dumps(ticket, indent=2)}\n\n"
                        "Investigate it with the tools, then close it by calling exactly one of "
                        "grant_access, deny_request or escalate."
                    ),
                },
            ]

            nudges = 0
            while not done and llm_calls < max_llm_calls:
                response = llm.chat.completions.create(
                    model=model,
                    messages=messages,
                    tools=tools,
                    tool_choice="auto",
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                llm_calls += 1
                if response.usage:
                    prompt_tokens += response.usage.prompt_tokens or 0
                    completion_tokens += response.usage.completion_tokens or 0
                msg = response.choices[0].message

                if not msg.tool_calls:
                    messages.append({"role": "assistant", "content": msg.content or ""})
                    nudges += 1
                    if nudges > 2:
                        error = "model stopped calling tools"
                        break
                    messages.append(
                        {
                            "role": "user",
                            "content": "You must act through tools. Continue the investigation, or close the ticket "
                            "with grant_access, deny_request or escalate.",
                        }
                    )
                    continue

                assistant_msg: Dict[str, Any] = {
                    "role": "assistant",
                    "content": msg.content or "",
                    "tool_calls": [
                        {
                            "id": tc.id,
                            "type": "function",
                            "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"},
                        }
                        for tc in msg.tool_calls
                    ],
                }
                messages.append(assistant_msg)

                for tc in msg.tool_calls:
                    if done:
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": tc.id,
                                "content": json.dumps({"error": "Episode already closed."}),
                            }
                        )
                        continue
                    try:
                        arguments = json.loads(tc.function.arguments or "{}")
                        if not isinstance(arguments, dict):
                            raise ValueError("arguments must be a JSON object")
                    except ValueError as exc:
                        payload: Any = {"error": f"Could not parse tool arguments as JSON: {exc}"}
                        tool_log.append(
                            {
                                "tool": tc.function.name,
                                "arguments": tc.function.arguments,
                                "result": payload,
                                "client_side_error": True,
                            }
                        )
                        messages.append({"role": "tool", "tool_call_id": tc.id, "content": json.dumps(payload)})
                        continue

                    step_result = env.step(CallToolAction(tool_name=tc.function.name, arguments=arguments))
                    steps += 1
                    payload = tool_payload(step_result.observation)
                    tool_log.append({"tool": tc.function.name, "arguments": arguments, "result": payload})
                    messages.append({"role": "tool", "tool_call_id": tc.id, "content": _compact(payload)})
                    if step_result.done:
                        done = True
                        reward = float(step_result.reward or 0.0)
                        final_meta = dict(step_result.observation.metadata or {})
            if not done and error is None:
                error = "llm call budget exhausted before the episode ended"
    except Exception as exc:  # network / server errors
        error = f"{type(exc).__name__}: {exc}"

    # If the model never closed the ticket (stopped calling tools, ran out of
    # LLM calls, or a transport error), the environment produced no terminal
    # reward. We score that -0.5, the same value the environment assigns when
    # the step budget runs out without a decision.
    return EpisodeResult(
        seed=seed,
        model=model,
        reward=reward if done else -0.5,
        done=done,
        steps=steps,
        outcome=final_meta.get("outcome") if done else "no_decision",
        scenario_type=final_meta.get("scenario_type") or scenario_type,
        decision=final_meta.get("decision"),
        ground_truth=final_meta.get("ground_truth"),
        ticket=final_meta.get("ticket") or ticket,
        tool_calls=tool_log,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        llm_calls=llm_calls,
        latency_s=round(time.time() - started, 2),
        error=error,
        judge_score=final_meta.get("judge_score"),
        judge_bonus=final_meta.get("judge_bonus"),
        messages=messages,
    )


@dataclass
class BatchSummary:
    model: str
    prompt_name: str
    n: int
    mean_reward: float
    accuracy: float
    unauthorized_grants: int
    unnecessary_escalations: int
    errors: int
    mean_tool_calls: float
    mean_prompt_tokens: float
    mean_completion_tokens: float
    mean_latency_s: float
    outcomes: Dict[str, int]
    episodes: List[EpisodeResult] = field(default_factory=list)

    def to_dict(self, include_messages: bool = False, include_trajectory: bool = False) -> Dict[str, Any]:
        d = asdict(self)
        d["episodes"] = [
            e.to_dict(include_messages=include_messages, include_trajectory=include_trajectory) for e in self.episodes
        ]
        return d

    def one_line(self) -> str:
        return (
            f"{self.model} | {self.prompt_name}: reward={self.mean_reward:.3f} "
            f"accuracy={self.accuracy:.0%} unauthorized_grants={self.unauthorized_grants} "
            f"unnecessary_escalations={self.unnecessary_escalations} tool_calls={self.mean_tool_calls:.1f} "
            f"tokens/ep={self.mean_prompt_tokens + self.mean_completion_tokens:.0f}"
        )


def summarize(episodes: Sequence[EpisodeResult], model: str, prompt_name: str) -> BatchSummary:
    n = len(episodes)
    outcomes: Dict[str, int] = {}
    for e in episodes:
        outcomes[e.outcome or "none"] = outcomes.get(e.outcome or "none", 0) + 1
    return BatchSummary(
        model=model,
        prompt_name=prompt_name,
        n=n,
        mean_reward=round(sum(e.reward for e in episodes) / n, 4) if n else 0.0,
        accuracy=round(sum(1 for e in episodes if e.correct) / n, 4) if n else 0.0,
        unauthorized_grants=outcomes.get("unauthorized_grant", 0),
        unnecessary_escalations=outcomes.get("unnecessary_escalation", 0),
        errors=sum(1 for e in episodes if e.error),
        mean_tool_calls=round(sum(e.steps for e in episodes) / n, 2) if n else 0.0,
        mean_prompt_tokens=round(sum(e.prompt_tokens for e in episodes) / n, 1) if n else 0.0,
        mean_completion_tokens=round(sum(e.completion_tokens for e in episodes) / n, 1) if n else 0.0,
        mean_latency_s=round(sum(e.latency_s for e in episodes) / n, 2) if n else 0.0,
        outcomes=dict(sorted(outcomes.items())),
        episodes=list(episodes),
    )


def run_batch(
    system_prompt: str,
    seeds: Iterable[int],
    *,
    model: str = DEFAULT_POLICY_MODEL,
    env_url: str = DEFAULT_ENV_URL,
    workers: int = 8,
    prompt_name: str = "prompt",
    temperature: float = 0.0,
    verbose: bool = True,
) -> BatchSummary:
    """Run one episode per seed in parallel and summarise."""
    seeds = list(seeds)
    llm = make_llm()
    results: Dict[int, EpisodeResult] = {}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(
                run_episode, system_prompt, s, model=model, env_url=env_url, llm=llm, temperature=temperature
            ): s
            for s in seeds
        }
        for i, fut in enumerate(as_completed(futures), start=1):
            res = fut.result()
            results[res.seed] = res
            if verbose:
                print(
                    f"    [{i:>3}/{len(seeds)}] seed={res.seed} {res.scenario_type or '?':<26} "
                    f"reward={res.reward:+.2f} {res.outcome}{' error=' + res.error if res.error else ''} ({res.latency_s:.0f}s)",
                    flush=True,
                )
    ordered = [results[s] for s in seeds]
    summary = summarize(ordered, model=model, prompt_name=prompt_name)
    if verbose:
        print(summary.one_line())
    return summary


def save_json(obj: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=str))


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Run a Token Factory model against the Access Request environment.")
    parser.add_argument("--prompt", default="baseline", help="prompt name in prompts/ or a path")
    parser.add_argument("--model", default=DEFAULT_POLICY_MODEL)
    parser.add_argument("--env-url", default=DEFAULT_ENV_URL)
    parser.add_argument("--seeds", default="train", choices=["train", "holdout"])
    parser.add_argument("--n", type=int, default=13)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--start-server", action="store_true", help="start the env server on the port in --env-url")
    parser.add_argument("--out", default=None, help="write per-episode JSON here")
    args = parser.parse_args()

    proc = None
    if args.start_server:
        from env_server import start_env_server

        port = int(args.env_url.rsplit(":", 1)[-1])
        proc = start_env_server(port=port)
    try:
        seeds = train_seeds(args.n) if args.seeds == "train" else holdout_seeds(args.n)
        summary = run_batch(
            load_prompt(args.prompt),
            seeds,
            model=args.model,
            env_url=args.env_url,
            workers=args.workers,
            prompt_name=args.prompt,
        )
        for e in summary.episodes:
            print(
                f"  seed={e.seed} {e.scenario_type or '?':<26} reward={e.reward:+.2f} outcome={e.outcome} steps={e.steps}"
                + (f" error={e.error}" if e.error else "")
            )
        if args.out:
            save_json(summary.to_dict(include_messages=True, include_trajectory=True), Path(args.out))
    finally:
        if proc is not None:
            from env_server import stop_env_server

            stop_env_server(proc)
