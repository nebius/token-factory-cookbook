[Cookbook](../../README.md) / [Coding agents](../README.md) / [Factory Droid](README.md) / Results

# Test results

Run on 2026-11-23 with Droid 1.18.0 on macOS (Apple silicon), against
`https://api.tokenfactory.nebius.com/v1`. Model IDs below are a record of that
day's catalog, not a recommendation to hardcode them; take current IDs from
`scripts/list_models.py`.

## What was run

The task in `scripts/smoke_test.py`: a two-file Python project with one failing
test, and the prompt "run the tests, fix the bug in `calc.py`, run the tests
again, do not edit the test file". Droid ran headless:

```bash
droid exec --settings <file> -m <model-id> --auto medium -o stream-json --cwd <project> "<prompt>"
```

A run passes only if `python3 -m unittest` passes afterwards, run by the test
harness and not by the model, and the test file is unchanged. Each model got
three runs. Every model that was live, advertised tool calling and was not
named as deprecating in a Nebius notice was included.

## Results

| Model | Passed | Average time | Average tool calls |
| --- | --- | --- | --- |
| `moonshotai/Kimi-K3.1-Pro` | 3/3 | 12 s | 2.7 |
| `moonshotai/Kimi-K3` | 3/3 | 5 s | 2.3 |
| `zai-org/GLM-5.3` | 3/3 | 8 s | 4.7 |
| `zai-org/GLM-5.3-Flash` | 3/3 | 10 s | 4.0 |
| `zai-org/GLM-5.2` | 3/3 | 6 s | 4.7 |
| `deepseek-ai/DeepSeek-V4-Pro-0813` | 3/3 | 10 s | 5.0 |
| `deepseek-ai/DeepSeek-V4.1-Flash-1017` | 3/3 | 7 s | 5.0 |
| `MiniMaxAI/MiniMax-M3` | 3/3 | 9 s | 5.0 |
| `MiniMaxAI/MiniMax-M3.1-Flash` | 3/3 | 9 s | 5.0 |
| `Qwen/Qwen3.8-27B` | 3/3 | 7 s | 4.3 |
| `Qwen/Qwen3-30B-A3B-Instruct-2507` | 3/3 | 11 s | 4.0 |
| `thinkingmachines/Inkling-2-Small` | 3/3 | 9 s | 5.0 |
| `nvidia/Nemotron-3-Ultra-550b-a55b` | 3/3 | 24 s | 4.7 |
| `nvidia/Nemotron-3.5-Super-VL` | 3/3 | 8 s | 5.3 |
| `meta-models/muse-spark-open` | 3/3 | 10 s | 5.0 |
| `NousResearch/Hermes-4-405B` | 3/3 | 12 s | 4.0 |
| `reflection/beam` | 3/3 with one extra setting (see below), 0/1 without | 8 s | 6.3 |
| `nvidia/Nemotron-3_5-Lightning` | 2/3 | 7 s | 4.7 |
| `openai/gpt-oss-120b` | 1/3 | 8 s | 8.0 |

## What went wrong, and where

**`reflection/beam` needs one extra setting.** Without it the second request
fails with `400 The assistant turn at messages[3] is missing its reasoning`.
Droid did not recognize this model ID, and for an unrecognized model it does
not send earlier reasoning back, which this model requires. Either of these
fixed it:

- `TF_BASE_MODEL_IDS=reflection/beam=beam-1.0`, which maps it to Droid's
  built-in Beam. 6 of 6 runs passed with no other change, and Droid reported
  reasoning effort `high` where it had reported `none`.
- `TF_ALLOW_MISSING_THINKING=reflection/beam`. 3 of 3 runs passed. The error
  text suggests `allow_missing_thinking=true`; as a top-level request field
  that changed nothing. It works inside `chat_template_kwargs`, which is what
  `make_settings.py` writes.

**`openai/gpt-oss-120b` produced malformed tool calls.** Droid rejected ten
calls across the three runs with "arguments were not a valid JSON object" and
two runs never recovered.

**`nvidia/Nemotron-3_5-Lightning` undid its own fix once.** In one run it fixed
the bug, ran the tests successfully, then reverted the edit and reported
success. The other two runs were clean.

**One unexplained empty run.** While trying the finished smoke test, one
`zai-org/GLM-5.3-Flash` run ended after three seconds with no tool calls and no
error. It did not happen again in nine further runs of that model, and the
smoke test now prints Droid's exit code and last reply when a run fails.

## Interactive session

Checked by hand on the same day, same Droid version, signed in to a Factory
account:

- `/model` listed the three configured models under **Custom Models**, next to
  Factory's own.
- `moonshotai/Kimi-K3.1-Pro` created a file through Droid's Create tool.
- After switching the same session to `reflection/beam` (with
  `TF_ALLOW_MISSING_THINKING` set), it edited that file. Droid showed a notice
  that the model "does not map to a built-in model".
- `/stats` showed the sessions as 100% BYOK. `/cost`, which Factory's
  documentation mentions, does not exist in 1.18.0.

## Other observations

- No Factory sign-in was needed for `droid exec` with a custom model.
  Interactive `droid` requires one.
- Every completed run reported `factory_credits: 0`.
- A typical run sent about 10,000 fresh input tokens and read about 40,000 from
  Token Factory's prompt cache, for under 1,000 output tokens. Droid reported
  cache reads on all 51 completed runs.
- `-m` accepted the plain Token Factory model ID. Factory's documentation
  describes the longer `custom:<Display-Name>-<index>` form, which also worked.
- Droid reported reasoning effort `high` for 12 of the 19 models with no
  mapping, which suggests it recognized those IDs as its own built-in models.
  It reported `none` for the Beam, gpt-oss, Hermes, both Qwen and two of the
  Nemotron models. Only Beam failed because of it.

## Not tested

The Factory desktop app, image input, missions, subagents, long sessions that
reach compaction, and any platform other than macOS.
