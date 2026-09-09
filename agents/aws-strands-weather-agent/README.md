# Strands Agents + Nebius Token Factory

This small smoke recipe connects [Strands Agents](https://github.com/strands-agents/harness-sdk) to Nebius Token Factory through Strands' existing `OpenAIModel`. It streams the answer and requires the model to call one deterministic local tool.

No Strands provider adapter or LiteLLM routing is required. This recipe exercises the OpenAI-compatible Chat Completions surface used by `OpenAIModel`; it does not claim full OpenAI API parity or stateful Responses behavior.

## Prerequisites

- Python 3.11 or newer.
- [uv](https://docs.astral.sh/uv/).
- A Nebius Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com/).
- A current model that supports function calling. The sample suggests `zai-org/GLM-5.1`; verify it, or choose another model, in the [live model catalog](https://tokenfactory.nebius.com/model-catalog.md).

## Setup

```bash
cd agents/aws-strands-weather-agent
uv sync
cp env.example .env
```

Edit `.env` and provide both required values:

```dotenv
NEBIUS_API_KEY=your_key_here
NEBIUS_MODEL=zai-org/GLM-5.1
```

The model is intentionally required at runtime rather than hard-coded. Model availability changes, and IDs are case-sensitive.

## Run the smoke recipe

```bash
uv run agent.py
```

The agent:

1. creates Strands' generic `OpenAIModel` with `https://api.tokenfactory.nebius.com/v1`;
2. registers a deterministic `get_temperature` tool;
3. streams text from `agent.stream_async()`; and
4. fails if the model never selects the tool.

The tool returns fixed demonstration data and makes no external request. A successful run verifies the configured model can complete a basic Strands tool-call/result loop and stream its final text; it does not establish compatibility with every Strands or OpenAI feature.

## Offline validation

The configuration tests require no API key and make no network requests:

```bash
uv run python -m unittest -v test_config.py
```

They check the canonical URL, explicit key/model mapping, Chat Completions parameters, missing-configuration error, and the tool-bearing streaming request Strands formats for the OpenAI client.

## Troubleshooting

- **Missing environment variables** — copy `env.example` to `.env` and set both values. Do not commit `.env`.
- **401 Unauthorized** — verify the key has no quotes, placeholder text, or `Bearer` prefix.
- **404 / model not found** — compare the exact model ID with the live catalog and the models available to your key. Do not guess a replacement from the model family name.
- **Wrong endpoint** — `base_url` must be `https://api.tokenfactory.nebius.com/v1`. Do not append `/chat/completions`; the OpenAI client adds the route.
- **The smoke test reports no tool call** — confirm the selected model currently advertises function calling. Try the plain prompt path separately before treating a tool-selection failure as a platform defect.
- **Streaming fails but a non-streaming request works** — keep `stream_options.include_usage` enabled (the Strands default) and capture the provider error. This recipe targets streamed Chat Completions, so silently disabling streaming would not validate the intended path.
- **You need Responses-specific features** — Strands has a separate `OpenAIResponsesModel`. Token Factory's Responses-compatible surface is stateless and must be validated per model and workflow; it is outside this recipe.

## Resources

- [Strands OpenAI model provider](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/model-providers/openai/)
- [Strands streaming guide](https://strandsagents.com/latest/documentation/docs/user-guide/concepts/streaming/async-iterators/)
- [Token Factory model catalog](https://tokenfactory.nebius.com/model-catalog.md)
- [Token Factory Chat Completions API](https://docs.tokenfactory.nebius.com/api-reference/inference/chat-completion)
