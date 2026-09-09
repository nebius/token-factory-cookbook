"""
Reflective prompt optimization against OpenEnv rewards.

The loop:

1. Evaluate the current best system prompt on the training seeds.
2. Collect the failed episodes (reward < 1) with their tool traces, decision
   and the ground truth the environment revealed at the end of the episode.
3. Ask a strong Token Factory model (the "reflector") to diagnose the
   failures and write an improved system prompt.
4. Evaluate the candidate on the same seeds. Keep it if the mean reward
   improves. Repeat.
5. Report baseline vs best on held-out seeds the optimizer never saw.

Only the prompt changes. The policy model's weights never do, which is why
this works with hosted models.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from agent import (
    DEFAULT_ENV_URL,
    DEFAULT_POLICY_MODEL,
    DEFAULT_REFLECTOR_MODEL,
    PROMPTS_DIR,
    RESULTS_DIR,
    BatchSummary,
    EpisodeResult,
    holdout_seeds,
    load_prompt,
    make_llm,
    run_batch,
    save_json,
    train_seeds,
)

MIN_PROMPT_WORDS = 40

REFLECTOR_SYSTEM = """You are an expert at writing operating instructions for LLM agents that work through tool calls.
You will be shown the current system prompt of an IT service-desk agent, and a set of episodes where the agent
scored below the maximum reward in a simulated environment. Each episode shows the ticket, the tools the agent
called, its final decision and the correct decision according to the company access policy.

Your job is to rewrite the system prompt so the agent scores higher on NEW tickets of the same kind.

Rules for the rewritten prompt:
- It must be general. Never mention specific ticket ids, employee ids, names or seeds.
- It may only reference tools that appear in the episodes. Do not invent tools or parameters.
- Encode the decision procedure the agent should follow, including the order in which checks are applied and how
  to map findings to grant_access / deny_request / escalate with the right reason_code and recipient.
- Keep it under 700 words. Plain text or light markdown.
- Remember that the environment penalises wrong grants far more than anything else, mildly penalises needless
  escalation, and charges a small cost per extra tool call, so aim for correct decisions in few calls.
- Fix the failures WITHOUT breaking the successful episodes: they show the full range of correct outcomes
  (grant, deny with various reason codes, escalate to different recipients). Cover all of them in the procedure.

Respond with a short diagnosis (max 8 bullet points) followed by the complete new system prompt wrapped in
<system_prompt> and </system_prompt> tags."""


def _compact_episode(e: EpisodeResult, max_tool_chars: int = 600) -> Dict[str, Any]:
    trace = []
    for call in e.tool_calls:
        result = call.get("result")
        text = result if isinstance(result, str) else json.dumps(result, default=str)
        if len(text) > max_tool_chars:
            text = text[:max_tool_chars] + " ...[truncated]"
        trace.append({"tool": call.get("tool"), "arguments": call.get("arguments"), "result": text})
    return {
        "ticket": e.ticket,
        "tool_trace": trace,
        "agent_decision": e.decision,
        "correct_decision": e.ground_truth,
        "outcome": e.outcome,
        "reward": e.reward,
        "error": e.error,
    }


def _one_per_archetype(episodes: List[EpisodeResult]) -> List[EpisodeResult]:
    """Pick at most one episode per scenario archetype, preserving order."""
    seen, out = set(), []
    for e in episodes:
        key = e.scenario_type or e.seed
        if key in seen:
            continue
        seen.add(key)
        out.append(e)
    return out


def _render_episodes(episodes: List[EpisodeResult], limit: int) -> str:
    chunks = []
    for i, e in enumerate(episodes[:limit], start=1):
        chunks.append(f"### Episode {i}\n```json\n{json.dumps(_compact_episode(e), indent=1, default=str)}\n```")
    return "\n\n".join(chunks)


def reflect(
    current_prompt: str,
    failures: List[EpisodeResult],
    successes: List[EpisodeResult],
    *,
    reflector_model: str = DEFAULT_REFLECTOR_MODEL,
    attempt: int = 1,
    attempts: int = 1,
    max_failures: int = 12,
    max_successes: int = 13,
    temperature: float = 0.7,
    max_tokens: int = 16000,
) -> Dict[str, Any]:
    """Ask the reflector model for an improved system prompt."""
    llm = make_llm()
    user = (
        f"## Current system prompt\n\n{current_prompt}\n\n"
        f"## Failed or imperfect episodes ({len(failures)} total, showing {min(len(failures), max_failures)})\n\n"
        f"{_render_episodes(failures, max_failures)}\n\n"
        f"## Successful episodes for contrast (one per scenario type; the new prompt must keep these correct)\n\n"
        f"{_render_episodes(_one_per_archetype(successes), max_successes)}\n\n"
        f"This is candidate {attempt} of {attempts}. "
        + (
            "Explore a noticeably different structure or emphasis from what a first attempt would produce. "
            if attempt > 1
            else ""
        )
        + "Write the diagnosis, then the full new system prompt inside <system_prompt> tags."
    )
    started = time.time()
    # Reasoning models spend a large share of the completion budget on thinking
    # before they write the prompt, so the budget is generous and we retry once
    # if the answer comes back without a usable <system_prompt> block.
    text, usage = "", {}
    new_prompt, diagnosis = "", ""
    for attempt_no in range(2):
        response = llm.chat.completions.create(
            model=reflector_model,
            messages=[{"role": "system", "content": REFLECTOR_SYSTEM}, {"role": "user", "content": user}],
            temperature=temperature,
            max_tokens=max_tokens,
        )
        text = response.choices[0].message.content or ""
        usage = {
            "prompt_tokens": getattr(response.usage, "prompt_tokens", None),
            "completion_tokens": getattr(response.usage, "completion_tokens", None),
        }
        match = re.search(r"<system_prompt>(.*?)</system_prompt>", text, re.S)
        if match:
            new_prompt = match.group(1).strip()
            diagnosis = text.split("<system_prompt>")[0].strip()
        elif "<system_prompt>" in text:  # closing tag lost to truncation: take what is there
            diagnosis, _, tail = text.partition("<system_prompt>")
            new_prompt, diagnosis = tail.strip(), diagnosis.strip()
        if len(new_prompt.split()) >= MIN_PROMPT_WORDS:
            break
        new_prompt = ""
    return {
        "prompt": new_prompt,
        "diagnosis": diagnosis,
        "reflector_model": reflector_model,
        "latency_s": round(time.time() - started, 1),
        "usage": usage,
        "raw_length": len(text),
    }


@dataclass
class OptimizationRun:
    policy_model: str
    reflector_model: str
    train_seeds: List[int]
    holdout_seeds: List[int]
    baseline_prompt: str
    best_prompt: str
    baseline_train: Dict[str, Any]
    best_train: Dict[str, Any]
    baseline_holdout: Optional[Dict[str, Any]] = None
    best_holdout: Optional[Dict[str, Any]] = None
    rounds: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "policy_model": self.policy_model,
            "reflector_model": self.reflector_model,
            "train_seeds": self.train_seeds,
            "holdout_seeds": self.holdout_seeds,
            "baseline_prompt": self.baseline_prompt,
            "best_prompt": self.best_prompt,
            "baseline_train": self.baseline_train,
            "best_train": self.best_train,
            "baseline_holdout": self.baseline_holdout,
            "best_holdout": self.best_holdout,
            "rounds": self.rounds,
        }


FULL_TRAJECTORIES = False  # set True (or pass --full-trajectories) to keep tool traces in optimization_run.json


def _summary_dict(s: BatchSummary) -> Dict[str, Any]:
    return s.to_dict(include_messages=False, include_trajectory=FULL_TRAJECTORIES)


def optimize(
    baseline_prompt: str,
    *,
    policy_model: str = DEFAULT_POLICY_MODEL,
    reflector_model: str = DEFAULT_REFLECTOR_MODEL,
    env_url: str = DEFAULT_ENV_URL,
    n_train: int = 26,
    n_holdout: int = 26,
    rounds: int = 3,
    candidates_per_round: int = 2,
    workers: int = 8,
    min_improvement: float = 0.01,
    out_dir: Path = RESULTS_DIR,
    save_prompt_to: Optional[Path] = PROMPTS_DIR / "optimized.md",
    verbose: bool = True,
) -> OptimizationRun:
    tr = train_seeds(n_train)
    ho = holdout_seeds(n_holdout)

    def log(msg: str) -> None:
        if verbose:
            print(msg, flush=True)

    log(
        f"[optimize] policy={policy_model} reflector={reflector_model} train={len(tr)} holdout={len(ho)} rounds={rounds} candidates/round={candidates_per_round}"
    )
    log("[optimize] evaluating baseline on train seeds ...")
    best_prompt = baseline_prompt
    best_train = run_batch(
        best_prompt, tr, model=policy_model, env_url=env_url, workers=workers, prompt_name="baseline", verbose=verbose
    )
    baseline_train = best_train

    run = OptimizationRun(
        policy_model=policy_model,
        reflector_model=reflector_model,
        train_seeds=tr,
        holdout_seeds=ho,
        baseline_prompt=baseline_prompt,
        best_prompt=best_prompt,
        baseline_train=_summary_dict(baseline_train),
        best_train=_summary_dict(best_train),
    )

    for r in range(1, rounds + 1):
        failures = [e for e in best_train.episodes if e.reward < 1.0]
        successes = [e for e in best_train.episodes if e.reward >= 1.0]
        log(
            f"[round {r}] best train reward={best_train.mean_reward:.3f}; {len(failures)} imperfect episodes feed the reflector"
        )
        if not failures:
            log("[optimize] no failures left on the training seeds, stopping early")
            break
        round_record: Dict[str, Any] = {"round": r, "candidates": []}
        for c in range(1, candidates_per_round + 1):
            proposal = reflect(
                best_prompt,
                failures,
                successes,
                reflector_model=reflector_model,
                attempt=c,
                attempts=candidates_per_round,
            )
            if not proposal["prompt"]:
                log(
                    f"[round {r} candidate {c}] reflector returned no usable prompt (raw length {proposal['raw_length']}, usage {proposal['usage']}); skipping"
                )
                round_record["candidates"].append(
                    {"candidate": c, "accepted": False, "skipped": True, "reflector_usage": proposal["usage"]}
                )
                continue
            log(
                f"[round {r} candidate {c}] reflector returned {len(proposal['prompt'].split())} words in {proposal['latency_s']}s; evaluating ..."
            )
            cand = run_batch(
                proposal["prompt"],
                tr,
                model=policy_model,
                env_url=env_url,
                workers=workers,
                prompt_name=f"round{r}_cand{c}",
                verbose=verbose,
            )
            accepted = cand.mean_reward > best_train.mean_reward + min_improvement
            round_record["candidates"].append(
                {
                    "candidate": c,
                    "accepted": accepted,
                    "train": _summary_dict(cand),
                    "prompt": proposal["prompt"],
                    "diagnosis": proposal["diagnosis"],
                    "reflector_latency_s": proposal["latency_s"],
                    "reflector_usage": proposal["usage"],
                }
            )
            if accepted:
                log(f"[round {r} candidate {c}] ACCEPTED: {best_train.mean_reward:.3f} -> {cand.mean_reward:.3f}")
                best_prompt, best_train = proposal["prompt"], cand
            else:
                log(f"[round {r} candidate {c}] rejected: {cand.mean_reward:.3f} vs best {best_train.mean_reward:.3f}")
        run.rounds.append(round_record)
        run.best_prompt = best_prompt
        run.best_train = _summary_dict(best_train)
        save_json(run.to_dict(), out_dir / "optimization_run.json")

    log("[optimize] evaluating baseline and best prompt on held-out seeds ...")
    run.baseline_holdout = _summary_dict(
        run_batch(
            baseline_prompt,
            ho,
            model=policy_model,
            env_url=env_url,
            workers=workers,
            prompt_name="baseline/holdout",
            verbose=verbose,
        )
    )
    run.best_holdout = _summary_dict(
        run_batch(
            best_prompt,
            ho,
            model=policy_model,
            env_url=env_url,
            workers=workers,
            prompt_name="optimized/holdout",
            verbose=verbose,
        )
    )
    save_json(run.to_dict(), out_dir / "optimization_run.json")
    if save_prompt_to is not None:
        save_prompt_to.parent.mkdir(parents=True, exist_ok=True)
        save_prompt_to.write_text(best_prompt + "\n")
        log(f"[optimize] best prompt written to {save_prompt_to}")
    return run


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Optimize the agent's system prompt against environment reward.")
    parser.add_argument("--baseline", default="baseline")
    parser.add_argument("--policy-model", default=DEFAULT_POLICY_MODEL)
    parser.add_argument("--reflector-model", default=DEFAULT_REFLECTOR_MODEL)
    parser.add_argument("--env-url", default=DEFAULT_ENV_URL)
    parser.add_argument("--n-train", type=int, default=26)
    parser.add_argument("--n-holdout", type=int, default=26)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--candidates", type=int, default=2)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--out-dir", default=str(RESULTS_DIR), help="where optimization_run.json is written")
    parser.add_argument("--save-prompt-to", default=str(PROMPTS_DIR / "optimized.md"))
    parser.add_argument(
        "--full-trajectories", action="store_true", help="keep tool traces and tickets per episode in the JSON output"
    )
    args = parser.parse_args()
    FULL_TRAJECTORIES = args.full_trajectories

    proc = None
    if args.start_server:
        from env_server import start_env_server

        proc = start_env_server(port=int(args.env_url.rsplit(":", 1)[-1]))
    try:
        run = optimize(
            load_prompt(args.baseline),
            policy_model=args.policy_model,
            reflector_model=args.reflector_model,
            env_url=args.env_url,
            n_train=args.n_train,
            n_holdout=args.n_holdout,
            rounds=args.rounds,
            candidates_per_round=args.candidates,
            workers=args.workers,
            out_dir=Path(args.out_dir),
            save_prompt_to=Path(args.save_prompt_to),
        )
        print("\n=== Held-out results ===")
        print(
            f"baseline : reward={run.baseline_holdout['mean_reward']:.3f} accuracy={run.baseline_holdout['accuracy']:.0%} unauthorized_grants={run.baseline_holdout['unauthorized_grants']}"
        )
        print(
            f"optimized: reward={run.best_holdout['mean_reward']:.3f} accuracy={run.best_holdout['accuracy']:.0%} unauthorized_grants={run.best_holdout['unauthorized_grants']}"
        )
    finally:
        if proc is not None:
            from env_server import stop_env_server

            stop_env_server(proc)
