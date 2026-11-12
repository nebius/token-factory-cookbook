import json
import shutil
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from pathlib import Path


def create_workspace(
    run_dir: Path,
    model: str,
    input_data_dir: Path,
    output_data_dir: Path = Path("output"),
) -> Path:
    workspace = run_dir / model.replace("/", "__")

    if workspace.exists():
        shutil.rmtree(workspace)

    shutil.copytree(input_data_dir, workspace / "input")

    (workspace / output_data_dir).mkdir(parents=True)

    return workspace


def collect_usage(messages):
    """Aggregate token usage and tool-call counts from a message list.

    Note: 'turns' counts every message whose type is 'ai', so middleware or
    reasoning messages in addition to end-user turns may inflate it.
    """
    input_tokens = 0
    output_tokens = 0
    tool_calls = 0
    turns = 0
    tool_usage = {}

    for message in messages:
        usage = getattr(message, "usage_metadata", None)

        if usage:
            input_tokens += usage.get("input_tokens", 0)
            output_tokens += usage.get("output_tokens", 0)

        if getattr(message, "type", None) == "ai":
            turns += 1

        calls = getattr(message, "tool_calls", None)

        if calls:
            tool_calls += len(calls)

            for call in calls:
                tool_name = call.get("name", "unknown")
                tool_usage[tool_name] = tool_usage.get(tool_name, 0) + 1

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "tool_calls": tool_calls,
        "turns": turns,
        "tool_usage": tool_usage,
    }


def validate_result(workspace: Path, expected: dict):
    result_path = workspace / "output" / "result.json"
    summary_path = workspace / "output" / "summary.md"

    actual = None
    parse_error = None
    if result_path.exists():
        try:
            loaded = json.loads(
                result_path.read_text(encoding="utf-8")
            )
            if isinstance(loaded, dict):
                actual = loaded
            else:
                parse_error = "result.json root is not a JSON object"
        except Exception as exc:
            parse_error = f"failed to parse result.json: {exc}"

    if parse_error:
        print(f"  [warn] {parse_error}")

    expected_keys = set(expected.keys())

    checks = {
        "result_created": result_path.exists(),
        "valid_json": actual is not None,
        "keys_match_expected": (
            actual is not None
            and set(actual.keys()) == expected_keys
        ),
        "result_parse_error": parse_error is None,
    }

    for key in expected:
        if actual is None or key not in actual:
            checks[key] = False
            continue

        expected_value = expected[key]
        actual_value = actual[key]

        if isinstance(expected_value, str):
            checks[key] = (
                str(actual_value).strip().lower()
                == expected_value.strip().lower()
            )
        else:
            checks[key] = actual_value == expected_value

    checks["summary_created"] = summary_path.exists()
    if summary_path.exists():
        summary = summary_path.read_text(
            encoding="utf-8"
        ).strip()
        checks["summary_nonempty"] = len(summary) > 50
    else:
        checks["summary_nonempty"] = False

    correctness_checks = [checks[key] for key in expected]

    score = (
        sum(correctness_checks) / len(correctness_checks)
        if correctness_checks
        else 0.0
    )
    success = (
        bool(correctness_checks)
        and checks["keys_match_expected"]
        and all(correctness_checks)
    )
    all_checks_score = sum(checks.values()) / len(checks)

    return {
        "success": success,
        "score": score,
        "all_checks_score": all_checks_score,
        "checks": checks,
        "actual": actual,
    }


def print_validation(result):
    print("\nValidation")

    name_width = max(len(name) for name in result["checks"]) + 1

    for name, passed in result["checks"].items():
        status = "PASS" if passed else "FAIL"
        print(f"  {name:<{name_width}} {status}")

    print(f"\n  Score:      {result['score']:.0%}")
    print(f"  Robustness: {result['all_checks_score']:.0%}")


def print_metrics(result):
    print("\nMetrics")

    tool_usage = (
        ", ".join(
            f"{name}={count}"
            for name, count in sorted(result["tool_usage"].items())
        )
        or "none"
    )

    rows = [
        ("Agent turns:", str(result["turns"])),
        ("Tool calls:", str(result["tool_calls"])),
        ("Tool usage:", tool_usage),
        ("Input tokens:", f"{result['input_tokens']:,}"),
        ("Output tokens:", f"{result['output_tokens']:,}"),
        ("Total tokens:", f"{result['total_tokens']:,}"),
        ("E2E latency:", f"{result['latency_seconds']:.2f}s"),
        ("Estimated cost:", f"${result['cost']:.6f}"),
    ]

    if result["error"]:
        rows.append(("Error:", result["error"]))

    label_width = max(len(label) for label, _ in rows) + 1

    for label, value in rows:
        print(f"  {label:<{label_width}}{value}")


def print_summary(result):
    summary_path = (
        result["workspace"]
        / "output"
        / "summary.md"
    )

    print()
    print("Final Summary")
    print("-" * 72)

    if summary_path.exists():
        print(
            summary_path.read_text(
                encoding="utf-8"
            ).strip()
        )
    else:
        print("summary.md was not created.")

    print("-" * 72)


def print_comparison(results):
    headers = [
        "Model",
        "Success",
        "Score",
        "Turns",
        "Calls",
        "In Tok",
        "Out Tok",
        "Tot Tok",
        "Time",
        "Cost ▲",
    ]

    ordered = sorted(results, key=lambda result: result["cost"])

    rows = [
        [
            result["model_id"],
            "YES" if result["success"] else "NO",
            f"{result['score']:.0%}",
            str(result["turns"]),
            str(result["tool_calls"]),
            f"{result['input_tokens']:,}",
            f"{result['output_tokens']:,}",
            f"{result['total_tokens']:,}",
            f"{result['latency_seconds']:.2f}s",
            f"${result['cost']:.6f}",
        ]
        for result in ordered
    ]

    widths = [
        max([len(headers[i])] + [len(row[i]) for row in rows])
        for i in range(len(headers))
    ]

    def format_row(cells):
        padded = (cell.ljust(widths[i]) for i, cell in enumerate(cells))
        return "| " + " | ".join(padded) + " |"

    print()
    print("MODEL COMPARISON")
    print()
    print(format_row(headers))
    print("|" + "|".join("-" * (width + 2) for width in widths) + "|")

    for row in rows:
        print(format_row(row))


def _to_json_value(value):
    """Convert an arbitrary value to a JSON-serializable representation."""
    if isinstance(value, (str, int, float, bool, type(None))):
        return value
    if isinstance(value, (list, tuple)):
        return [_to_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _to_json_value(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        return _to_json_value(value.model_dump())
    if hasattr(value, "dict"):
        return _to_json_value(value.dict())
    return str(value)


def serialize_message(message):
    """Return a JSON-serializable representation of a LangChain message."""
    entry = {
        "type": getattr(message, "type", type(message).__name__),
    }

    content = getattr(message, "content", None)
    if isinstance(content, str):
        entry["content"] = content
    elif isinstance(content, list):
        entry["content"] = _to_json_value(content)

    calls = getattr(message, "tool_calls", None)
    if calls:
        entry["tool_calls"] = _to_json_value(calls)

    if getattr(message, "type", None) == "tool":
        entry["tool_call_id"] = getattr(message, "tool_call_id", None)

    usage = getattr(message, "usage_metadata", None)
    if usage:
        entry["usage"] = _to_json_value(usage)

    name = getattr(message, "name", None)
    if name:
        entry["name"] = name

    return entry


def dump_transcript(
    response: dict,
    workspace: Path,
    output_dir: Path = Path("output"),
) -> None:
    """Write the agent message history to the workspace output directory."""
    try:
        messages = response.get("messages", [])
        payload = [serialize_message(message) for message in messages]
        path = workspace / output_dir / "_transcript.json"
        path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except Exception as exc:
        print(f"  [warn] failed to dump transcript: {exc}")


def _invoke_with_timeout(agent, invocation_input, config, timeout):
    """Run agent.invoke with a deadline."""
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(agent.invoke, invocation_input, config)
        return future.result(timeout=timeout)


def _recover_messages(agent, run_config, error: str) -> tuple[dict, str]:
    """Try to retrieve checkpointed messages after a failed/timed-out run."""
    try:
        state = agent.get_state(run_config)
        return {"messages": list(state.values.get("messages", []))}, error
    except Exception as recovery_exc:
        return {"messages": []}, f"{error}\n[state recovery failed: {recovery_exc}]"
