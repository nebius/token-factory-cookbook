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

NEMOTRON_MODEL = "nvidia/Nemotron-3-Ultra-550b-a55b"
NEMOTRON_INPUT_PRICE_PER_1M = 1.00
NEMOTRON_OUTPUT_PRICE_PER_1M = 3.00

OPENAI_MODEL = "gpt-5.5"
OPENAI_INPUT_PRICE_PER_1M = 5.00
OPENAI_OUTPUT_PRICE_PER_1M = 30.00

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
    """Choose the longest message content that contains a markdown heading."""
    best = ""
    for msg in messages:
        content = getattr(msg, "content", None)
        if isinstance(content, str) and "# " in content and len(content) > len(best):
            best = content
    if not best:
        raise RuntimeError("No markdown content found in agent result")
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

    output_path = Path(f"output_{name.replace('/', '_')}.md")
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


def print_comparison(
    metrics_a: dict[str, int | float],
    name_a: str,
    in_a: float,
    out_a: float,
    metrics_b: dict[str, int | float],
    name_b: str,
    in_b: float,
    out_b: float,
) -> None:
    """Print a neatly aligned side-by-side token / cost / tool-call comparison."""
    cost_a = compute_cost(metrics_a["input_tokens"], metrics_a["output_tokens"], in_a, out_a)
    cost_b = compute_cost(metrics_b["input_tokens"], metrics_b["output_tokens"], in_b, out_b)

    labels = [
        "Metric", "Tool calls", "Input tokens", "Output tokens",
        "Total tokens", "Elapsed (s)", "Est. cost",
    ]
    label_width = max(len(label) for label in labels) + 2
    col_width = max(len(name_a), len(name_b), 12) + 2
    rule = "-" * (label_width + 2 * col_width)

    def _row(label: str, left: str, right: str) -> None:
        print(f"{label:<{label_width}}{left:>{col_width}}{right:>{col_width}}")

    def _num_row(label: str, left: int, right: int) -> None:
        print(f"{label:<{label_width}}{left:>{col_width},}{right:>{col_width},}")

    print("\n=== Side-by-side comparison ===")
    _row("Metric", name_a, name_b)
    print(rule)
    _num_row("Tool calls", metrics_a["tool_calls"], metrics_b["tool_calls"])
    _num_row("Input tokens", metrics_a["input_tokens"], metrics_b["input_tokens"])
    _num_row("Output tokens", metrics_a["output_tokens"], metrics_b["output_tokens"])
    _num_row("Total tokens", metrics_a["total_tokens"], metrics_b["total_tokens"])
    _row(
        "Elapsed (s)",
        f"{metrics_a['elapsed_seconds']:.3f}",
        f"{metrics_b['elapsed_seconds']:.3f}",
    )
    _row("Est. cost", f"${cost_a:,.6f}", f"${cost_b:,.6f}")
    print(rule)

    if cost_a < cost_b:
        delta = cost_b - cost_a
        pct = (delta / cost_b * 100) if cost_b else 0.0
        print(f"\n{name_a} is cheaper by ${delta:.6f} ({pct:.1f}%) vs {name_b}.")
    elif cost_b < cost_a:
        delta = cost_a - cost_b
        pct = (delta / cost_a * 100) if cost_a else 0.0
        print(f"\n{name_b} is cheaper by ${delta:.6f} ({pct:.1f}%) vs {name_a}.")
    else:
        print("\nBoth runs have the same estimated cost.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    if not os.getenv("NEBIUS_API_KEY"):
        print("Warning: NEBIUS_API_KEY not set in environment / .env")

    # --- Run 1: Nemotron ----------------------------------------------------
    nemotron_model = ChatNebius(model=NEMOTRON_MODEL)
    _, nemotron_metrics = run_single_agent(
        NEMOTRON_MODEL,
        nemotron_model,
        QUERY,
    )
    print_model_summary(
        NEMOTRON_MODEL,
        nemotron_metrics,
        NEMOTRON_INPUT_PRICE_PER_1M,
        NEMOTRON_OUTPUT_PRICE_PER_1M,
    )

    # --- Run 2: OpenAI GPT --------------------------------------------------
    # Pass the OpenAI model as a provider-prefixed string so deepagents applies
    # its OpenAI provider profile (Responses API + tool-use defaults), and
    # pair it with the research tools + a system prompt that pushes the model
    # to call tools instead of answering from training data.
    _, openai_metrics = run_single_agent(
        OPENAI_MODEL,
        f"openai:{OPENAI_MODEL}",
        QUERY,
        system_prompt=RESEARCH_SYSTEM_PROMPT,
    )
    print_model_summary(
        OPENAI_MODEL,
        openai_metrics,
        OPENAI_INPUT_PRICE_PER_1M,
        OPENAI_OUTPUT_PRICE_PER_1M,
    )

    # --- Comparison ---------------------------------------------------------
    print_comparison(
        nemotron_metrics,
        NEMOTRON_MODEL,
        NEMOTRON_INPUT_PRICE_PER_1M,
        NEMOTRON_OUTPUT_PRICE_PER_1M,
        openai_metrics,
        OPENAI_MODEL,
        OPENAI_INPUT_PRICE_PER_1M,
        OPENAI_OUTPUT_PRICE_PER_1M,
    )


if __name__ == "__main__":
    main()
