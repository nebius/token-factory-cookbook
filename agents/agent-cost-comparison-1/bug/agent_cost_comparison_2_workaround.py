import argparse
import json
import os
import time
from pathlib import Path

from dotenv import load_dotenv

from deepagents import HarnessProfile, create_deep_agent, register_harness_profile
from deepagents.backends import FilesystemBackend
from langchain_nebius import ChatNebius
from langgraph.checkpoint.memory import InMemorySaver
from utils import (
    collect_usage,
    create_workspace,
    dump_transcript,
    print_comparison,
    print_metrics,
    print_summary,
    print_validation,
    validate_result,
    _invoke_with_timeout,
    _recover_messages,
)

load_dotenv()


# ============================================================
# Configuration
# ============================================================

NEBIUS_API_KEY = os.getenv("NEBIUS_API_KEY")

BENCHMARK_ROOT = Path(__file__).parent / "benchmarks"
OUTPUT_DATA_DIR = Path("output")
AGENT_TIMEOUT = 300  # seconds (5 minutes)

HARNESS_PROFILE_MODEL = "nebius:nvidia/Nemotron-3-Ultra-550b-a55b"

TASK = (
    "Analyze the workspace data and create the required output files."
)


# NemotronPolicyNudgeMiddleware mistakes this single-turn file task for a task
# transition. The runtime profile override below disables only that middleware.


MODELS = [
    {
        "model_id": "nvidia/Nemotron-3-Ultra-550b-a55b",
        "input_price_per_1m": 1.00,
        "output_price_per_1m": 3.00,
        "max_tokens": 16384,
    },
    {
        "model_id": "nvidia/nemotron-3-super-120b-a12b",
        "input_price_per_1m": 0.30,
        "output_price_per_1m": 0.90,
        "max_tokens": 16384,
    },
    {
        "model_id": "nvidia/Nemotron-3_5-Lightning",
        "input_price_per_1m": 0.06,
        "output_price_per_1m": 0.24,
        "max_tokens": 16384,
    },
]

SYSTEM_PROMPT = """
Use only the workspace files to compare Q1 and Q2 revenue. Calculate each
change as Q2 minus Q1, then identify:

1. The region with the largest absolute revenue change.
2. That region's signed revenue change.
3. Within that region, the product with the largest change in the same
   direction as the region's change.

The change may be positive or negative. A negative change must be prefixed
with a minus sign (for example, -10000) in both output files. Do not
substitute words like "decline" or "decrease", parentheses, or any other
notation for the sign.

Verify the calculations, then create both output files. Do not delete or
rewrite them after creation.

/output/result.json must contain exactly:

{
  "region": "string",
  "change": number,
  "primary_product": "string"
}

/output/summary.md must contain exactly this heading and three bullets. Each
bullet must include the actual computed value from result.json after the colon:

# Sales Analysis

- Region with the largest revenue change: <actual region>
- Dollar amount of that change (signed): <actual signed change>
- Product that contributed most to the change: <actual product>

Replace every angle-bracketed placeholder with the real value. Label-only
bullets, placeholders, and copied instructions are invalid. Read summary.md
after writing it and confirm that all three actual values are present.
"""


# ============================================================
# Run one model
# ============================================================

def run_model(
    model_config: dict,
    data_dir: Path,
    expected: dict,
    dump_transcript_flag: bool,
) -> dict:
    """Run a single model against the benchmark and return scored metrics."""
    name = model_config["model_id"]

    print()
    print("=" * 72)
    print(f"Running model: {name}")
    print("=" * 72)

    workspace = create_workspace(
        run_dir=BENCHMARK_ROOT / data_dir.name,
        model=name,
        input_data_dir=data_dir / "input",
        output_data_dir=OUTPUT_DATA_DIR,
    )

    # --------------------------------------------------------
    # Nebius LangChain adapter
    # --------------------------------------------------------

    model = ChatNebius(
        model=model_config["model_id"],
        api_key=NEBIUS_API_KEY,
        temperature=0,
        max_tokens=model_config["max_tokens"],
    )

    # --------------------------------------------------------
    # Deep Agent backend
    #
    # FilesystemBackend has no shell/code-execution tool, so the
    # agent is confined to the file tools (ls/read/write/edit/glob/
    # grep), which are jailed to `workspace` under virtual_mode.
    # --------------------------------------------------------

    backend = FilesystemBackend(
        root_dir=workspace,
        virtual_mode=True,
    )

    # --------------------------------------------------------
    # Deep Agent
    # --------------------------------------------------------

    agent = create_deep_agent(
        model=model,
        backend=backend,
        system_prompt=SYSTEM_PROMPT,
        checkpointer=InMemorySaver(),
    )

    # --------------------------------------------------------
    # Execute benchmark
    # --------------------------------------------------------

    run_config = {"configurable": {"thread_id": name}}

    start = time.perf_counter()

    try:
        response = _invoke_with_timeout(
            agent,
            {
                "messages": [
                    {
                        "role": "user",
                        "content": TASK,
                    }
                ]
            },
            run_config,
            AGENT_TIMEOUT,
        )
        error = None

    except TimeoutError:
        # The run hit the deadline. Some steps may still have been checkpointed
        # before the cutoff, so try to recover them for accurate token/cost
        # reporting.
        response, error = _recover_messages(
            agent,
            run_config,
            f"agent.invoke timed out after {AGENT_TIMEOUT}s",
        )

    except (KeyboardInterrupt, SystemExit):
        # Let the process exit cleanly on user/external signals.
        raise

    except Exception as exc:
        # Recover whatever messages were checkpointed before the crash, so
        # tokens/cost already billed for this run aren't reported as zero.
        response, error = _recover_messages(agent, run_config, str(exc))

    elapsed = time.perf_counter() - start

    if dump_transcript_flag:
        dump_transcript(response, workspace, OUTPUT_DATA_DIR)

    # --------------------------------------------------------
    # Metrics
    # --------------------------------------------------------

    usage = collect_usage(
        response.get("messages", [])
    )

    validation = validate_result(workspace, expected)

    input_cost = (
        usage["input_tokens"]
        / 1_000_000
        * model_config["input_price_per_1m"]
    )

    output_cost = (
        usage["output_tokens"]
        / 1_000_000
        * model_config["output_price_per_1m"]
    )

    total_cost = input_cost + output_cost

    return {
        "model_id": name,

        "success": validation["success"],
        "score": validation["score"],
        "all_checks_score": validation["all_checks_score"],

        "checks": validation["checks"],
        "actual": validation["actual"],

        "turns": usage["turns"],
        "tool_calls": usage["tool_calls"],
        "tool_usage": usage["tool_usage"],

        "input_tokens": usage["input_tokens"],
        "output_tokens": usage["output_tokens"],

        "total_tokens": (
            usage["input_tokens"]
            + usage["output_tokens"]
        ),

        "latency_seconds": elapsed,

        "cost": total_cost,

        "workspace": workspace,

        "error": error,
    }


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--data-dir",
        default="data-1",
        help="data suite directory under the script's parent (default: data-1)",
    )
    parser.add_argument(
        "--dump-transcript",
        action="store_true",
        help="write the message transcript to <workspace>/output/_transcript.json",
    )
    args = parser.parse_args()

    if not NEBIUS_API_KEY:
        parser.error("NEBIUS_API_KEY environment variable is not set")

    # Register the Nemotron-3-Ultra harness profile override at runtime rather
    # than at import time, so importing the module does not mutate global state.
    register_harness_profile(
        HARNESS_PROFILE_MODEL,
        HarnessProfile(
            excluded_middleware={"NemotronPolicyNudgeMiddleware"},
        ),
    )

    data_suite_dir = Path(__file__).parent / args.data_dir
    expected_path = data_suite_dir / "expected.json"

    expected = json.loads(expected_path.read_text(encoding="utf-8"))

    BENCHMARK_ROOT.mkdir(
        parents=True,
        exist_ok=True,
    )

    print()
    print("=" * 72)
    print(f"Data suite: {args.data_dir}")
    print(f"  input:    {args.data_dir}/input")
    print(f"  expected: {args.data_dir}/expected.json")
    print("=" * 72)

    results = []

    for model_config in MODELS:
        result = run_model(
            model_config,
            data_dir=data_suite_dir,
            expected=expected,
            dump_transcript_flag=args.dump_transcript,
        )
        results.append(result)

        print_validation(result)
        print_metrics(result)
        print_summary(result)

    print_comparison(results)


if __name__ == "__main__":
    main()
