import os
import re
import time
from pathlib import Path
from typing import Any

from deepagents import create_deep_agent
from langchain_nebius import ChatNebius
from dotenv import load_dotenv

load_dotenv()


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
QUERY = "Research Solar power adoption in US and write a report"

# Add or remove models here to compare them in a single run.
MODELS = [
    {
        "name": "nvidia/Nemotron-3-Ultra-550b-a55b",
        "input_price_per_1m": 1.00,
        "output_price_per_1m": 3.00,
    },
    {
        "name": "nvidia/nemotron-3-super-120b-a12b",
        "input_price_per_1m": 0.30,
        "output_price_per_1m": 0.90,
    },
    {
        "name": "moonshotai/Kimi-K3",
        "input_price_per_1m": 3.00,
        "output_price_per_1m": 15.00,
    },
    {
        "name": "MiniMaxAI/MiniMax-M3",
        "input_price_per_1m": 0.30,
        "output_price_per_1m": 1.20,
    },
    {
        "name": "moonshotai/Kimi-K2.7-Code",
        "input_price_per_1m": 0.95,
        "output_price_per_1m": 4.00,
    },
]

RESEARCH_SYSTEM_PROMPT = (
    "You are a deep research agent. You have access to filesystem, shell execution, "
    "and task tools. When asked to research a topic and write a report, do not rely "
    "only on your training data; use the available tools to gather current information "
    "before producing the final report."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def extract_clean_markdown(text: str) -> str:
    """Strip model/tool artifacts and return only the markdown-report section."""
    wrapped = False
    marker = "<content>"
    idx = text.find(marker)
    if idx != -1:
        text = text[idx + len(marker):]
        wrapped = True

    if not wrapped:
        match = re.search(r"^# .+", text, flags=re.MULTILINE)
        if match:
            text = text[match.start():]

    text = re.sub(r"<[/]?content>", "", text)
    lines = [
        line.lstrip()
        for line in text.splitlines()
        if not line.strip().startswith(("<tool_call", "[<]minimax", "]<]minimax"))
    ]
    return "\n".join(lines).strip()


def find_best_markdown(messages: list[Any]) -> str:
    """Choose the longest message content, preferring one that contains a markdown heading."""
    best_with_heading = ""
    best_any = ""
    for msg in messages:
        content = getattr(msg, "content", None)
        if not isinstance(content, str):
            continue
        if len(content) > len(best_any):
            best_any = content
        if "# " in content and len(content) > len(best_with_heading):
            best_with_heading = content
    best = best_with_heading or best_any
    if not best:
        raise RuntimeError("No message content found in agent result")
    return best


def _get_message_tokens(msg: Any) -> tuple[int, int]:
    """Extract input/output tokens from a message's usage metadata."""
    usage = getattr(msg, "usage_metadata", None)
    if isinstance(usage, dict):
        return int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
    if usage is not None:
        return int(getattr(usage, "input_tokens", 0) or 0), int(
            getattr(usage, "output_tokens", 0) or 0
        )

    response_metadata = getattr(msg, "response_metadata", {}) or {}
    token_usage = (
        response_metadata.get("token_usage")
        if isinstance(response_metadata, dict)
        else None
    )
    if isinstance(token_usage, dict):
        return int(token_usage.get("prompt_tokens") or 0), int(
            token_usage.get("completion_tokens") or 0
        )

    return 0, 0


def aggregate_metrics(messages: list[Any]) -> dict[str, int]:
    """Sum tool calls and tokens for an agent run."""
    input_tokens = 0
    output_tokens = 0
    tool_calls = 0

    for msg in messages:
        if getattr(msg, "type", None) != "ai":
            continue

        tool_calls += len(getattr(msg, "tool_calls", []) or [])
        inp, out = _get_message_tokens(msg)
        input_tokens += inp
        output_tokens += out

    return {
        "tool_calls": tool_calls,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }


def compute_cost(input_tokens: int, output_tokens: int, in_price: float, out_price: float) -> float:
    """Return estimated cost in USD for the given token counts and per-1M prices."""
    return (input_tokens * in_price + output_tokens * out_price) / 1_000_000


# ---------------------------------------------------------------------------
# Agent execution
# ---------------------------------------------------------------------------
def run_single_agent(
    name: str,
    model: Any,
    query: str,
    system_prompt: str | None = None,
) -> tuple[str, dict[str, int | float]]:
    """Run a deep agent with the given model and return cleaned markdown + metrics."""
    print(f"\n=== Running deep research with {name} ===")
    agent = create_deep_agent(
        model=model,
        system_prompt=system_prompt,
    )

    t0 = time.monotonic()
    result = agent.invoke({"messages": [{"role": "user", "content": query}]})
    elapsed = time.monotonic() - t0

    messages = result.get("messages", [])
    raw_markdown = find_best_markdown(messages)
    markdown = extract_clean_markdown(raw_markdown).lstrip()

    safe_name = name.replace("/", "_")
    output_path = Path(f"output_{safe_name}.md")
    output_path.write_text(markdown, encoding="utf-8")
    print(f"Wrote report ({len(markdown)} chars) to {output_path}")

    metrics = aggregate_metrics(messages)
    metrics["elapsed_seconds"] = elapsed
    return markdown, metrics


def print_model_summary(name: str, metrics: dict[str, int | float], in_price: float, out_price: float) -> None:
    """Print tool-call, token and wall-clock metrics for a single run."""
    cost = compute_cost(metrics["input_tokens"], metrics["output_tokens"], in_price, out_price)
    print(f"\n--- {name} run summary ---")
    print(f"Tool calls:    {metrics['tool_calls']}")
    print(f"Input tokens:  {metrics['input_tokens']:,}")
    print(f"Output tokens: {metrics['output_tokens']:,}")
    print(f"Total tokens:  {metrics['total_tokens']:,}")
    print(f"Elapsed time:  {metrics['elapsed_seconds']:.3f}s")
    print(f"Est. cost:     ${cost:.6f} (@ In ${in_price}/1M, Out ${out_price}/1M)")


def print_final_summary(results: list[dict[str, Any]]) -> None:
    """Print a summary table comparing all model runs."""
    if not results:
        print("\n=== Final comparison summary ===")
        print("No successful model runs to summarize.")
        return

    print("\n=== Final comparison summary ===")

    name_width = max(len(r["name"]) for r in results) + 2
    label_width = 18
    header = (
        f"{'Model':<{name_width}}"
        f"{'Tool calls':>{label_width}}"
        f"{'Input tokens':>{label_width}}"
        f"{'Output tokens':>{label_width}}"
        f"{'Total tokens':>{label_width}}"
        f"{'Elapsed (s)':>{label_width}}"
        f"{'Est. cost':>{label_width}}"
    )
    rule = "-" * len(header)
    print(header)
    print(rule)

    rows = []
    for r in results:
        metrics = r["metrics"]
        cost = compute_cost(
            metrics["input_tokens"],
            metrics["output_tokens"],
            r["input_price"],
            r["output_price"],
        )
        rows.append({
            "name": r["name"],
            "tool_calls": metrics["tool_calls"],
            "input_tokens": metrics["input_tokens"],
            "output_tokens": metrics["output_tokens"],
            "total_tokens": metrics["total_tokens"],
            "elapsed": metrics["elapsed_seconds"],
            "cost": cost,
        })

    rows_sorted = sorted(rows, key=lambda x: x["name"])

    for row in rows_sorted:
        cost_str = f"${row['cost']:.6f}"
        print(
            f"{row['name']:<{name_width}}"
            f"{row['tool_calls']:>{label_width},}"
            f"{row['input_tokens']:>{label_width},}"
            f"{row['output_tokens']:>{label_width},}"
            f"{row['total_tokens']:>{label_width},}"
            f"{row['elapsed']:>{label_width}.3f}"
            f"{cost_str:>{label_width}}"
        )

    print(rule)

    cheapest = min(rows, key=lambda x: x["cost"])
    fastest = min(rows, key=lambda x: x["elapsed"])

    print(f"\nCheapest: {cheapest['name']}")
    print(f"  Tool calls:    {cheapest['tool_calls']}")
    print(f"  Input tokens:  {cheapest['input_tokens']:,}")
    print(f"  Output tokens: {cheapest['output_tokens']:,}")
    print(f"  Total tokens:  {cheapest['total_tokens']:,}")
    print(f"  Elapsed time:  {cheapest['elapsed']:.3f}s")
    print(f"  Est. cost:     ${cheapest['cost']:.6f}")

    print(f"\nFastest: {fastest['name']}")
    print(f"  Tool calls:    {fastest['tool_calls']}")
    print(f"  Input tokens:  {fastest['input_tokens']:,}")
    print(f"  Output tokens: {fastest['output_tokens']:,}")
    print(f"  Total tokens:  {fastest['total_tokens']:,}")
    print(f"  Elapsed time:  {fastest['elapsed']:.3f}s")
    print(f"  Est. cost:     ${fastest['cost']:.6f}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    if not os.getenv("NEBIUS_API_KEY"):
        print("Warning: NEBIUS_API_KEY not set in environment / .env")

    results: list[dict[str, Any]] = []

    for model_cfg in MODELS:
        model_name = model_cfg["name"]
        in_price = model_cfg["input_price_per_1m"]
        out_price = model_cfg["output_price_per_1m"]

        try:
            model = ChatNebius(model=model_name)
            _, metrics = run_single_agent(
                model_name,
                model,
                QUERY,
                system_prompt=RESEARCH_SYSTEM_PROMPT,
            )

            print_model_summary(model_name, metrics, in_price, out_price)

            results.append({
                "name": model_name,
                "metrics": metrics,
                "input_price": in_price,
                "output_price": out_price,
            })
        except Exception as exc:
            print(f"\n!!! {model_name} failed: {exc}")

    print_final_summary(results)


if __name__ == "__main__":
    main()
