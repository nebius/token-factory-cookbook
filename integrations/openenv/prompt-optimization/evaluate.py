"""
Compare system prompts across Token Factory models on held-out seeds.

Produces a markdown table (results/evaluation.md) and the raw per-episode
data (results/evaluation.json).
"""

from __future__ import annotations

from pathlib import Path
from typing import Dict, List

from agent import (
    DEFAULT_ENV_URL,
    DEFAULT_POLICY_MODEL,
    RESULTS_DIR,
    BatchSummary,
    holdout_seeds,
    load_prompt,
    run_batch,
    save_json,
)


def evaluate(
    prompts: Dict[str, str],
    models: List[str],
    *,
    seeds: List[int],
    env_url: str = DEFAULT_ENV_URL,
    workers: int = 8,
    verbose: bool = True,
) -> List[BatchSummary]:
    summaries: List[BatchSummary] = []
    for model in models:
        for name, prompt in prompts.items():
            summaries.append(
                run_batch(
                    prompt, seeds, model=model, env_url=env_url, workers=workers, prompt_name=name, verbose=verbose
                )
            )
    return summaries


def to_markdown(summaries: List[BatchSummary]) -> str:
    lines = [
        "| Model | Prompt | Mean reward | Decision accuracy | Unauthorized grants | Unnecessary escalations | Tool calls / episode | Tokens / episode |",
        "|---|---|---:|---:|---:|---:|---:|---:|",
    ]
    for s in summaries:
        lines.append(
            f"| {s.model} | {s.prompt_name} | {s.mean_reward:.3f} | {s.accuracy:.0%} | {s.unauthorized_grants} | "
            f"{s.unnecessary_escalations} | {s.mean_tool_calls:.1f} | {s.mean_prompt_tokens + s.mean_completion_tokens:,.0f} |"
        )
    return "\n".join(lines)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Evaluate prompts across models on held-out seeds.")
    parser.add_argument(
        "--prompts", nargs="+", default=["baseline", "optimized"], help="prompt names in prompts/ or paths"
    )
    parser.add_argument("--models", nargs="+", default=[DEFAULT_POLICY_MODEL])
    parser.add_argument("--n", type=int, default=26)
    parser.add_argument("--env-url", default=DEFAULT_ENV_URL)
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--start-server", action="store_true")
    parser.add_argument("--out", default=str(RESULTS_DIR / "evaluation"))
    parser.add_argument(
        "--full-trajectories", action="store_true", help="keep tool traces and tickets per episode in the JSON output"
    )
    args = parser.parse_args()

    proc = None
    if args.start_server:
        from env_server import start_env_server

        proc = start_env_server(port=int(args.env_url.rsplit(":", 1)[-1]))
    try:
        prompts = {Path(p).stem if Path(p).exists() else p: load_prompt(p) for p in args.prompts}
        summaries = evaluate(
            prompts, args.models, seeds=holdout_seeds(args.n), env_url=args.env_url, workers=args.workers
        )
        table = to_markdown(summaries)
        print("\n" + table)
        out = Path(args.out)
        save_json(
            [s.to_dict(include_messages=False, include_trajectory=args.full_trajectories) for s in summaries],
            out.with_suffix(".json"),
        )
        out.with_suffix(".md").write_text(table + "\n")
        print(f"\nwrote {out.with_suffix('.md')} and {out.with_suffix('.json')}")
    finally:
        if proc is not None:
            from env_server import stop_env_server

            stop_env_server(proc)
