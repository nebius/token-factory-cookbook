[Cookbook](../../README.md) / [APIs](../README.md) / Comparing models

# Comparing models on your own prompt

Send the same text task to several models on Nebius Token Factory, save their
answers, and compare response time and token usage. Decide what a good answer
looks like before running the comparison.

## What you will build

A small Python script using the OpenAI-compatible Chat Completions API at
`https://api.tokenfactory.nebius.com/v1/`. It runs each model three times by
default, saving answers, full response JSON, and metrics in a new local folder.
Failed requests are recorded and the comparison continues with the next request.

The default models are:

- Beam: `reflection/beam`
- Muse Spark Open: `meta-models/muse-spark-open`
- Nemotron 3.5 Super VL: `nvidia/Nemotron-3.5-Super-VL`

These IDs match the [October 16, 2026 launch guide](https://nebius.com/blog/posts/three-new-open-weight-models-from-us-companies-give-builders-more-choice).
Check current availability, capabilities, and pricing in the
[model catalog](https://tokenfactory.nebius.com/models). Use `--models` to choose
other text-capable models or add your current model as a baseline.

## Requirements

- Python 3.10 or newer.
- A Token Factory account and an API key with access to your chosen models.
  Follow the [environment setup guide](../../start-here/setup.md).
- API credit: the default command makes nine potentially billable requests.
  Increasing repetitions or the output budget can increase cost.

The script creates local files and sends your prompt to Token Factory. It does
not provision infrastructure or execute the code in model responses.

## Setup

From this recipe's directory:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
export NEBIUS_API_KEY="your-api-key"
cp task.example.md task.md
```

Replace `task.md` with a representative task and explicit success criteria.
Include the context the model needs in that file: the script sends its contents
as one user message and does not read any other repository files.

## Run

```bash
python compare_models.py
```

To choose models, include your baseline's current catalog ID in the list:

```bash
python compare_models.py \
  --models reflection/beam meta-models/muse-spark-open nvidia/Nemotron-3.5-Super-VL YOUR_BASELINE_MODEL_ID \
  --runs 3 \
  --max-tokens 8192
```

Replace `YOUR_BASELINE_MODEL_ID` before running. `--models` replaces the whole
default list. For a smaller first check, use `--runs 1`. Use `--prompt path/to/task.md`
for another input, `--output-dir path/to/results` for another output root, or
`--timeout 300` for a longer request timeout in seconds.

Each request prints the model, repetition, elapsed time, input/output token
counts, finish reason, and status. Under `outputs/<run-id>/`, you will find:

| File | Contents |
| --- | --- |
| `task.md` | The exact prompt sent to each model |
| `config.json` | Requested models, repetitions, output budget, timeout, and retry settings |
| `01-reflection_beam-run-01.md` | The first model's first answer; each model/repetition has its own file |
| `01-reflection_beam-run-01.json` | The full API response, including usage details when returned |
| `metrics.csv`, `metrics.json` | One row per attempted request, including errors |

The metrics files are updated after each request. API errors record the exception
type and HTTP status when available; failed requests have no answer file. Missing
usage is left blank in CSV and `null` in JSON. The script exits with code 1 if any
request fails or needs review, while preserving the other results.

Compare answer files with your editor or `diff`, substituting your actual folder:

```bash
diff -u outputs/RUN_ID/01-reflection_beam-run-01.md \
        outputs/RUN_ID/02-meta-models_muse-spark-open-run-01.md
```

`diff` returns exit code 1 when the answers differ; that is expected.

## Interpret the results

`completed` means the API returned nonempty answer text with finish reason
`stop`. It does not establish correctness. Run proposed tests yourself and score
answers against the success criteria you wrote in advance.

`needs_review` flags empty answers, missing choices, truncation (`length`), or
another finish reason. A reasoning model can spend its output budget thinking
before producing an answer. Inspect the saved response and finish reason; if
the budget was exhausted, consider increasing `--max-tokens`. An empty answer
alone does not identify the cause.

Elapsed time measures the full non-streaming SDK request, including network and
server wait time. It is not time to first token or a throughput measurement.
SDK retries are disabled so an automatic retry does not silently inflate a
measurement. Requests are sequential, interleaved by repetition, and use provider
defaults for sampling and reasoning. Defaults, caching, and service load can
differ across models and runs; this is a practical starting comparison rather
than a controlled benchmark.

Token counts can differ because tokenizers and reasoning behavior differ. Use
current pricing and returned usage details for cost calculations, including
cached input or reasoning where applicable. The script does not calculate cost.
Judge cost per successful task across repeated runs, including failed attempts
and retries in your actual application.

This loop compares text responses. Test images, video, tools, multi-turn agent
behavior, and repository edits separately in your full workflow. For example:
did the agent call the right tools, how many retries did it need, and would a
reviewer merge the resulting change?

## Validate

These commands make no API calls:

```bash
python compare_models.py --help
python -m unittest discover -s . -p 'test_*.py'
```

The tests use the OpenAI SDK with a mock HTTP transport to check saved answers,
repeated requests, error continuation, empty/truncated replies, and missing usage.
Live inference against the default models has not been validated for this recipe.

## Limitations and cleanup

Keep your API key in the environment. Outputs contain your prompt and full model
responses, including any reasoning the API returns; keep them local unless you
intend to share them. `task.md` and `outputs/` are ignored by Git in this recipe.

Delete a generated run directory when you no longer need it. Remove `.venv/` to
remove the local Python environment. The recipe creates no remote resources to
clean up.

## Source and license

Based on Dylan Bristot's three-model comparison example for the Nebius builder
newsletter, with repeated runs, persisted metrics, and error handling added for
the cookbook. Licensed under the repository's [MIT license](../../LICENSE).
