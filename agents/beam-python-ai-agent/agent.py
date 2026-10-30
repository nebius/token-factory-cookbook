"""A Python data analyst agent: Beam answers business questions by writing and running pandas code."""

from __future__ import annotations

import argparse
import json
import os
import time

from openai import OpenAI

from workspace import DEFINITIONS, QUESTIONS, TOOLS, SalesWorkspace, call_tool

BASE_URL = os.environ.get("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1")
MODEL = os.environ.get("NEBIUS_MODEL", "reflection/beam")
EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max"]

SYSTEM = (
    "You are a data analyst. Answer the user's questions about orders.csv. "
    "Call describe_data first, compute every number with run_python (pandas is installed), "
    "and record each final answer with submit_answer. Check your work before you submit. "
    "When all three answers are recorded, reply with a two-sentence summary for a business reader."
)


def task_prompt() -> str:
    questions = "\n".join(f"{i}. {q}" for i, q in enumerate(QUESTIONS, 1))
    return f"{DEFINITIONS}\n\nQuestions:\n{questions}"


def list_prices(client: OpenAI, model: str) -> tuple[float, float] | None:
    """Read the per-token input and output price from the Token Factory catalog."""
    for entry in client.models.list(extra_query={"verbose": "true"}):
        pricing = (entry.model_extra or {}).get("pricing")
        if entry.id == model and pricing:
            return float(pricing["prompt"]), float(pricing["completion"])
    return None


def summarize(name: str, arguments: str | None, result: str) -> str:
    """One readable transcript line per tool call."""
    try:
        args = json.loads(arguments or "{}")
    except json.JSONDecodeError:
        args = {}
    data = json.loads(result)
    if name == "describe_data" and "rows" in data:
        return f"{data['file']}: {data['rows']:,} rows, {len(data['columns'])} columns"
    if name == "run_python":
        lines = args.get("code", "").count("\n") + 1
        output = (data.get("stdout") or data.get("stderr") or "").strip().replace("\n", " | ")
        return f"({lines} lines) -> {output[:150]}"
    if name == "submit_answer":
        return f"Q{args.get('question')} = {str(args.get('answer', ''))!r} -> {'recorded' if data.get('recorded') else data}"
    return json.dumps(data)[:120]


def play(
    client,
    seed: int,
    effort: str | None = None,
    max_turns: int = 16,
    max_tokens: int = 8000,
    prices: tuple[float, float] | None = None,
    log=print,
    show_reasoning: bool = False,
) -> dict:
    workspace = SalesWorkspace(seed)
    messages = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content": task_prompt()},
    ]
    extra_body = {"reasoning_effort": effort} if effort else {}
    totals = {"prompt_tokens": 0, "completion_tokens": 0, "reasoning_tokens": 0}
    tool_calls, script_errors, final, finish = 0, 0, None, "max_turns"
    started = time.perf_counter()

    for turn in range(1, max_turns + 1):
        response = client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=TOOLS,
            max_tokens=max_tokens,
            extra_body=extra_body,
        )
        usage = response.usage
        details = getattr(usage, "completion_tokens_details", None)
        totals["prompt_tokens"] += usage.prompt_tokens
        totals["completion_tokens"] += usage.completion_tokens
        totals["reasoning_tokens"] += getattr(details, "reasoning_tokens", None) or 0

        choice = response.choices[0]
        message = choice.message
        reasoning = getattr(message, "reasoning_content", None)
        if show_reasoning and reasoning:
            thought = " ".join(reasoning.split())
            log(f"           thinking: {thought[:160]}{'...' if len(thought) > 160 else ''}")

        # Beam needs its earlier reasoning back on later turns, so keep it in the history.
        assistant = {"role": "assistant", "content": message.content or ""}
        if reasoning:
            assistant["reasoning_content"] = reasoning
        if message.tool_calls:
            assistant["tool_calls"] = [
                {"id": call.id, "type": "function", "function": {"name": call.function.name, "arguments": call.function.arguments}}
                for call in message.tool_calls
            ]
        messages.append(assistant)

        if not message.tool_calls:
            final = (message.content or "").strip()
            finish = "answered" if final else choice.finish_reason
            break

        for call in message.tool_calls:
            tool_calls += 1
            result = call_tool(workspace, call.function.name, call.function.arguments)
            if call.function.name == "run_python" and json.loads(result).get("exit_code") != 0:
                script_errors += 1
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
            log(f"turn {turn:>2}  {call.function.name:<13}  {summarize(call.function.name, call.function.arguments, result)}")

    seconds = time.perf_counter() - started
    cost = None
    if prices:
        cost = totals["prompt_tokens"] * prices[0] + totals["completion_tokens"] * prices[1]
    graded = workspace.grade()
    return {
        "seed": seed,
        "effort": effort or "default",
        "model": MODEL,
        "correct": sum(graded),
        "graded": graded,
        "answers": [workspace.answers.get(i) for i in (1, 2, 3)],
        "expected": [workspace.expected[0], round(workspace.expected[1], 1), round(workspace.expected[2], 1)],
        "turns": turn,
        "tool_calls": tool_calls,
        "script_errors": script_errors,
        **totals,
        "seconds": round(seconds, 1),
        "cost_usd": round(cost, 5) if cost is not None else None,
        "finish": finish,
        "final": final,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--effort", choices=EFFORTS, help="reasoning_effort to send; omit for the model default")
    parser.add_argument("--max-turns", type=int, default=16)
    parser.add_argument("--show-reasoning", action="store_true", help="print the start of Beam's reasoning on each turn")
    parser.add_argument("--save", help="write the run record to this JSON file")
    args = parser.parse_args()

    client = OpenAI(base_url=BASE_URL, api_key=os.environ["NEBIUS_API_KEY"], timeout=120)
    prices = list_prices(client, MODEL)
    print(f"Beam data analyst | model {MODEL} | seed {args.seed} | effort {args.effort or 'default'}\n")
    run = play(
        client,
        args.seed,
        effort=args.effort,
        max_turns=args.max_turns,
        prices=prices,
        show_reasoning=args.show_reasoning,
    )

    marks = ["right" if ok else f"wrong, expected {exp}" for ok, exp in zip(run["graded"], run["expected"])]
    print()
    for number, (answer, mark) in enumerate(zip(run["answers"], marks), 1):
        print(f"Q{number}: {answer if answer is not None else '(no answer)'} ({mark})")
    print(
        f"Graded: {run['correct']} of 3 correct in {run['turns']} turns | {run['tool_calls']} tool calls | "
        f"{run['script_errors']} failed scripts"
    )
    print(
        f"Tokens: {run['prompt_tokens']:,} prompt | {run['completion_tokens']:,} completion "
        f"({run['reasoning_tokens']:,} reasoning)"
    )
    cost = f"${run['cost_usd']:.4f} at list price" if run["cost_usd"] is not None else "price unavailable"
    print(f"Cost: {cost} | {run['seconds']} s")
    if run["final"]:
        print(f"Beam: {run['final']}")
    if args.save:
        with open(args.save, "w") as handle:
            json.dump(run, handle, indent=2)


if __name__ == "__main__":
    main()
