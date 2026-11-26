# Test results

Run on 2026-11-24 with pi 1.6.0 on macOS (Apple silicon), against
`https://api.tokenfactory.nebius.com/v1`. Model IDs below are a record of that
day's catalog, not a recommendation to hardcode them; take current IDs from
`python3 scripts/make_models.py --list`.

## What was run

The task in `scripts/smoke_test.py`: a two-file Python project with one failing
test, and the prompt "run the tests, fix the bug in `calc.py`, run the tests
again, do not edit the test file". pi ran headless with the `models.json` that
`scripts/make_models.py` generated:

```bash
pi --provider nebius-token-factory --model <model-id> --no-session --mode json "<prompt>" < /dev/null
```

A run passes only if `python3 -m unittest` passes afterwards, run by the test
script and not by the model, and the test file is unchanged. Each model got
three runs. Every model that was live, advertised tool calling and was not
named as retiring in a Nebius deprecation notice was included.

## Results

| Model | Passed | Average time | Average tool calls |
| --- | --- | --- | --- |
| `moonshotai/Kimi-K3.1-Pro` | 3/3 | 6 s | 4.7 |
| `moonshotai/Kimi-K3` | 3/3 | 4 s | 4.0 |
| `zai-org/GLM-5.3` | 3/3 | 5 s | 4.3 |
| `zai-org/GLM-5.3-Flash` | 3/3 | 5 s | 4.0 |
| `zai-org/GLM-5.2` | 3/3 | 3 s | 5.0 |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | 3/3 | 11 s | 4.3 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | 3/3 | 4 s | 4.0 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017-fast` | 3/3 | 2 s | 4.0 |
| `MiniMaxAI/MiniMax-M3` | 3/3 | 5 s | 5.0 |
| `MiniMaxAI/MiniMax-M3.1-Flash` | 3/3 | 7 s | 6.0 |
| `Qwen/Qwen3.8-27B` | 3/3 | 4 s | 4.7 |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 3/3 | 7 s | 4.0 |
| `thinkingmachines/Inkling-2-Small` | 3/3 | 6 s | 4.3 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 3/3 | 6 s | 4.0 |
| `nvidia/Nemotron-3.5-Super-VL` | 3/3 | 5 s | 6.0 |
| `nvidia/Nemotron-3_5-Lightning` | 3/3 | 6 s | 7.0 |
| `meta-models/muse-spark-open` | 3/3 | 10 s | 4.7 |
| `NousResearch/Hermes-4-405B` | 3/3 | 5 s | 4.0 |
| `reflection/beam` | 3/3 | 3 s | 5.0 |
| `openai/gpt-oss-120b` | 3/3 | 28 s | 57.0 |
| `google/gemma-3-27b-it` | 0/3 | 1 s | 0.0 |

## What went wrong, and where

**`google/gemma-3-27b-it` never called a tool.** In all three runs it answered
with the command as text, such as a fenced `python3 -m unittest`, and stopped.
The catalog lists it as supporting tools. It is not usable in pi as tested.

**`openai/gpt-oss-120b` passed, slowly.** It averaged 57 tool calls and 28
seconds where the other models needed 4 to 7 calls.

**One server error was absorbed.** During the `nvidia/Nemotron-3_5-Lightning`
runs, one request returned `502 Unable to process request`. The run still
passed.

## Other paths tested the same day

The fix-the-bug task was also run on three models
(`moonshotai/Kimi-K3.1-Pro`, `reflection/beam`, `zai-org/GLM-5.3-Flash`)
through the community packages for pi:

| Path | Result | Notes |
| --- | --- | --- |
| `tokenfactory-pi` 0.3.0 | Passed on all three | Counts cached input as free in pi's cost display. |
| `pi-nebius` 0.5.0 | Passed on all three | Caps output at 4,096 tokens and shows cost as $0. |
| `@czottmann/pi-nebius-token-factory` 1.0.1 | Failed | On a fresh install run from a script, pi answered `Unknown provider "nebius-token-factory"`. |

## Observations

- `reflection/beam` needs its earlier reasoning sent back on each turn. pi did
  that with no extra setting.
- pi exits 0 when the API rejects a request. The error is only in the
  `--mode json` events, as `errorMessage`.
- With its input left open, as in a script, pi waits and never starts. Closing
  it with `< /dev/null` fixes that.
- `make_models.py --install` was checked against a scratch pi folder: pi then
  listed the models, and a `-p` prompt answered.

## Not tested

pi's interactive interface, image input, long sessions that reach compaction,
extensions other than the three packages above, and any platform other than
macOS.
