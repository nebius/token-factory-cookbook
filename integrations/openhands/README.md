# Use OpenHands with Nebius Token Factory

This recipe configures the current [OpenHands CLI](https://docs.openhands.dev/openhands/usage/cli/installation) to use the Nebius Token Factory OpenAI-compatible endpoint. OpenHands already routes custom providers through LiteLLM, so no Token Factory-specific adapter is needed.

## Prerequisites

- Python 3.12 or newer
- [`uv`](https://docs.astral.sh/uv/)
- A [Token Factory API key](https://tokenfactory.nebius.com/)

Install OpenHands using its documented CLI package:

```bash
uv tool install openhands --python 3.12
```

## Configure

Copy the example file and replace the placeholder key:

```bash
cp .env.example .env
set -a
source .env
set +a
```

Both `NEBIUS_API_KEY` and `NEBIUS_MODEL` are required. The example uses the current documented chat model `openai/gpt-oss-120b`; choose another active tool-capable model from the [Token Factory model catalog](https://tokenfactory.nebius.com/models) when needed.

Check the resolved configuration without making a network request:

```bash
python openhands_token_factory.py --check
```

The launcher maps the values to OpenHands' supported environment overrides:

| Token Factory input | OpenHands / LiteLLM value |
| --- | --- |
| `NEBIUS_API_KEY` | `LLM_API_KEY` |
| `openai/gpt-oss-120b` | `LLM_MODEL=openai/openai/gpt-oss-120b` |
| canonical endpoint | `LLM_BASE_URL=https://api.tokenfactory.nebius.com/v1` |

The first `openai/` in `LLM_MODEL` selects LiteLLM's generic OpenAI provider. The remaining `openai/gpt-oss-120b` is the Token Factory model ID sent to the API unchanged. The explicit base URL prevents LiteLLM from routing the request to OpenAI's own endpoint.

## Run

Start the interactive CLI:

```bash
python openhands_token_factory.py
```

Pass normal OpenHands options after the launcher name. For example, start a headless task with approval prompts still enabled:

```bash
python openhands_token_factory.py --headless -t "Summarize this repository"
```

The wrapper always includes OpenHands' `--override-with-envs` flag. Without it, the CLI deliberately ignores `LLM_API_KEY`, `LLM_MODEL`, and `LLM_BASE_URL` in favor of persisted settings.

## API scope

This configuration uses Chat Completions, which is OpenHands' default path for `openai/gpt-oss-120b`. It does not enable the Responses API or stateful continuation. Do not reuse a `previous_response_id` with Token Factory; keep the full multi-turn conversation in Chat Completions messages.

## Troubleshooting

- **Requests go to `api.openai.com`:** run through this wrapper and confirm `--check` reports the Token Factory base URL. An `openai/` model prefix without `LLM_BASE_URL` selects the provider but not the Token Factory endpoint.
- **Unknown model or 404:** set `NEBIUS_MODEL` to the exact slash-qualified ID shown in your Token Factory project. Do not include the extra LiteLLM `openai/` prefix yourself.
- **Environment values appear ignored:** invoke `python openhands_token_factory.py`; calling `openhands` directly without `--override-with-envs` can use stored settings instead.
- **Tool calls are malformed or absent:** choose a current model that advertises tool/function calling. OpenHands depends on reliable native tool calls.
- **Context-window error:** OpenHands requires at least 16,384 input tokens. Select a model/deployment with a larger context window rather than bypassing the safety check.
- **Rate limits or long pauses:** OpenHands can issue many concurrent, long-context calls. Reduce task scope and check your Token Factory limits before retrying.

## Offline tests

The tests validate required settings, model/provider mapping, the canonical base override, duplicate-prefix rejection, and the exact OpenHands launch command without starting OpenHands or making network requests:

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements-test.txt
pytest -q
```
