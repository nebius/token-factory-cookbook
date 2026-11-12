"""Compare the same text prompt across Token Factory models."""

import argparse
import csv
import json
import os
import re
from pathlib import Path
from time import perf_counter, time_ns

from openai import APIError, OpenAI


BASE_URL = "https://api.tokenfactory.nebius.com/v1/"
DEFAULT_MODELS = [
    "reflection/beam",
    "meta-models/muse-spark-open",
    "nvidia/Nemotron-3.5-Super-VL",
]


def positive_int(value):
    number = int(value)
    if number < 1:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return number


def compare(client, prompt, models, runs, max_tokens, output_dir):
    """Save each answer and response, and checkpoint metrics after every request."""
    output_dir.mkdir(parents=True, exist_ok=False)
    (output_dir / "task.md").write_text(prompt, encoding="utf-8")
    config = {
        "base_url": str(client.base_url),
        "models": models,
        "runs": runs,
        "max_tokens": max_tokens,
        "timeout_seconds": client.timeout,
        "sdk_retries": client.max_retries,
        "sampling_and_reasoning": "provider defaults",
    }
    (output_dir / "config.json").write_text(
        json.dumps(config, indent=2) + "\n", encoding="utf-8"
    )
    results = []
    for run in range(1, runs + 1):
        for index, model in enumerate(models, start=1):
            slug = re.sub(r"[^A-Za-z0-9_-]+", "_", model).strip("_")[:100]
            stem = f"{index:02d}-{slug}-run-{run:02d}"
            result = dict(
                model=model,
                run=run,
                status="error",
                elapsed_seconds=None,
                prompt_tokens=None,
                completion_tokens=None,
                total_tokens=None,
                finish_reason=None,
                answer_file=None,
                response_file=None,
                error_type=None,
                http_status=None,
            )
            started = perf_counter()
            try:
                response = client.chat.completions.create(
                    model=model,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=max_tokens,
                )
            except APIError as error:
                result["elapsed_seconds"] = round(perf_counter() - started, 3)
                result["error_type"] = type(error).__name__
                result["http_status"] = getattr(error, "status_code", None)
            else:
                result["elapsed_seconds"] = round(perf_counter() - started, 3)
                response_file = f"{stem}.json"
                (output_dir / response_file).write_text(
                    response.model_dump_json(indent=2) + "\n", encoding="utf-8"
                )
                result["response_file"] = response_file
                if response.usage:
                    result.update(
                        prompt_tokens=response.usage.prompt_tokens,
                        completion_tokens=response.usage.completion_tokens,
                        total_tokens=response.usage.total_tokens,
                    )
                if response.choices:
                    choice = response.choices[0]
                    answer = choice.message.content or ""
                    answer_file = f"{stem}.md"
                    (output_dir / answer_file).write_text(answer, encoding="utf-8")
                    result.update(
                        answer_file=answer_file,
                        finish_reason=choice.finish_reason,
                        status=(
                            "completed"
                            if answer.strip() and choice.finish_reason == "stop"
                            else "needs_review"
                        ),
                    )
                else:
                    result["status"] = "needs_review"
            results.append(result)
            (output_dir / "metrics.json").write_text(
                json.dumps(results, indent=2) + "\n", encoding="utf-8"
            )
            with (output_dir / "metrics.csv").open(
                "w", newline="", encoding="utf-8"
            ) as file:
                writer = csv.DictWriter(file, fieldnames=list(result))
                writer.writeheader()
                writer.writerows(results)
            print(
                f"{model} run={run} status={result['status']} "
                f"{result['elapsed_seconds']:.3f}s "
                f"input={result['prompt_tokens']} output={result['completion_tokens']} "
                f"finish={result['finish_reason']} error={result['error_type']}",
                flush=True,
            )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", type=Path, default=Path("task.md"))
    parser.add_argument("--models", nargs="+", default=DEFAULT_MODELS)
    parser.add_argument("--runs", type=positive_int, default=3)
    parser.add_argument("--max-tokens", type=positive_int, default=8192)
    parser.add_argument("--timeout", type=positive_int, default=120)
    parser.add_argument("--output-dir", type=Path, default=Path("outputs"))
    args = parser.parse_args()
    prompt = args.prompt.read_text(encoding="utf-8")
    if not prompt.strip():
        parser.error("the prompt file must not be empty")
    api_key = os.environ.get("NEBIUS_API_KEY")
    if not api_key:
        parser.error("set NEBIUS_API_KEY before running")
    output_dir = args.output_dir / str(time_ns())
    # Disable automatic retries so each measurement represents one SDK attempt.
    with OpenAI(
        base_url=BASE_URL, api_key=api_key, max_retries=0, timeout=args.timeout
    ) as client:
        results = compare(
            client, prompt, args.models, args.runs, args.max_tokens, output_dir
        )
    print(f"Saved answers, responses, configuration, and metrics to {output_dir}")
    return int(any(result["status"] != "completed" for result in results))


if __name__ == "__main__":
    raise SystemExit(main())
