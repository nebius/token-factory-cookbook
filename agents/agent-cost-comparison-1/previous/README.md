# Comparing Agent Cost Across Models

This script runs the same agentic task against multiple Nebius-hosted models and compares token usage, tool calls, wall-clock time, and estimated cost.

File: [`agent_cost_comparison.py`](agent_cost_comparison.py)

## Setup

Copy `env.example` to `.env` and add your Nebius API key:

```bash
NEBIUS_API_KEY=your_key_here
```

## Configure the comparison

Open `agent_cost_comparison.py` and edit the `MODELS` list. Each entry needs a model name and per-1M-token pricing:

```python
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
]
```

You can also change the `QUERY` constant to run a different task.

## Run

```bash
uv run python agent_cost_comparison.py
```

Each model's report is written to `output_<model_name>.md` in the current directory. The console output shows per-run metrics followed by a comparison summary.

## Sample output

```text
=== Running deep research with nvidia/Nemotron-3-Ultra-550b-a55b ===
Wrote report (1726 chars) to output_nvidia_Nemotron-3-Ultra-550b-a55b.md

--- nvidia/Nemotron-3-Ultra-550b-a55b run summary ---
Tool calls:    2
Input tokens:  19,249
Output tokens: 8,657
Total tokens:  27,906
Elapsed time:  31.793s
Est. cost:     $0.045220 (@ In $1.0/1M, Out $3.0/1M)

=== Running deep research with nvidia/nemotron-3-super-120b-a12b ===
Wrote report (4534 chars) to output_nvidia_nemotron-3-super-120b-a12b.md

--- nvidia/nemotron-3-super-120b-a12b run summary ---
Tool calls:    8
Input tokens:  29,279
Output tokens: 3,929
Total tokens:  33,208
Elapsed time:  21.286s
Est. cost:     $0.012320 (@ In $0.3/1M, Out $0.9/1M)

=== Final comparison summary ===
Model                            Tool calls      Input tokens     Output tokens      Total tokens       Elapsed (s)         Est. cost
-------------------------------------------------------------------------------------------------------------------------------------
MiniMaxAI/MiniMax-M3                        4            21,086             5,196            26,282            42.865         $0.012561
moonshotai/Kimi-K2.7-Code                   6            48,195             5,470            53,665          1437.686         $0.067665
moonshotai/Kimi-K3                          9            66,580             7,198            73,778          1808.597         $0.307710
nvidia/nemotron-3-super-120b-a12b           8            29,279             3,929            33,208            21.286         $0.012320
nvidia/Nemotron-3-Ultra-550b-a55b           2            19,249             8,657            27,906            31.793         $0.045220
-------------------------------------------------------------------------------------------------------------------------------------

Cheapest: nvidia/nemotron-3-super-120b-a12b
  Tool calls:    8
  Input tokens:  29,279
  Output tokens: 3,929
  Total tokens:  33,208
  Elapsed time:  21.286s
  Est. cost:     $0.012320

Fastest: nvidia/nemotron-3-super-120b-a12b
  Tool calls:    8
  Input tokens:  29,279
  Output tokens: 3,929
  Total tokens:  33,208
  Elapsed time:  21.286s
  Est. cost:     $0.012320
```
