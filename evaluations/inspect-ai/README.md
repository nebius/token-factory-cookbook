# Evaluate Token Factory models with Inspect AI

This recipe runs a small, reproducible [Inspect AI](https://inspect.aisi.org.uk/) task against the Nebius Token Factory OpenAI-compatible endpoint. It uses Inspect's existing `openai` provider; no Token Factory-specific adapter is needed.

The included smoke task has two fixed samples, temperature zero, and deterministic exact-answer scoring. It is intentionally small enough to check a model or account before starting a larger evaluation.

## Prerequisites

- Python 3.11 or newer
- A [Token Factory API key](https://tokenfactory.nebius.com/)
- A current chat-completions model ID from the [model catalog](https://tokenfactory.nebius.com/models)

## Set up

From this directory:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -e .
```

Copy the example configuration, replace the key if needed, and load it into your shell:

```bash
cp .env.example .env
set -a
source .env
set +a
```

`NEBIUS_API_KEY` and `NEBIUS_MODEL` are both required. The example currently uses `openai/gpt-oss-120b`; choose another active chat model if it is not available to your account.

## Run the evaluation

```bash
python run_eval.py
```

The runner maps `NEBIUS_API_KEY` to Inspect's `OPENAI_API_KEY`, sets the canonical base URL to `https://api.tokenfactory.nebius.com/v1`, and selects the model as:

```text
openai/openai/gpt-oss-120b
└────┘ └──────────────────┘
Inspect       Token Factory
provider      model ID
```

Inspect writes logs to `logs/`. Open the local viewer with:

```bash
inspect view --log-dir logs
```

## Chat Completions and Responses API scope

This recipe explicitly sets `responses_api=False`, so Inspect uses Chat Completions. That is the safe default for evaluation flows that may grow into multi-turn tasks.

Do not change this example to `responses_api=True` unless every sample is an independent, stateless first turn. Token Factory's Responses API currently does not support stateful continuation fields such as `previous_response_id`; multi-turn evaluation state should stay in Chat Completions messages.

## Validate without an API key

The tests use Inspect's in-process mock model and make no network requests:

```bash
python -m pip install -e '.[test]'
pytest
```

They verify required configuration, provider/model mapping, the canonical endpoint, the Chat Completions guard, and the complete task/scorer pipeline.
