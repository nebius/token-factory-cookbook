# Google ADK tool-calling agent with Token Factory

This example connects [Google Agent Development Kit (ADK)](https://google.github.io/adk-docs/) to Nebius Token Factory through ADK's `LiteLlm` model wrapper. It demonstrates a small currency-conversion tool agent without adding a native ADK provider.

## Prerequisites

- Python 3.12 or later
- A [Token Factory API key](https://tokenfactory.nebius.com/)
- A current tool-capable model ID from the [public model catalog](https://tokenfactory.nebius.com/api/public/models_info)

## Setup

```bash
git clone https://github.com/nebius/token-factory-cookbook.git
cd token-factory-cookbook/agents/google-adk-tool-calling
cp env.sample .env
```

Set both required values in `.env`:

```dotenv
NEBIUS_API_KEY=your_nebius_api_key_here
NEBIUS_MODEL=moonshotai/Kimi-K2.7-Code
```

The suggested model was current and advertised function calling when this example was updated on August 13, 2026. `NEBIUS_MODEL` is required so the example does not silently keep using that ID after the public catalog changes.

Install with `uv`:

```bash
uv sync
```

Or with `pip`:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

From this directory:

```bash
uv run adk run .
```

If you used `pip`, activate the virtual environment and run `adk run .` instead. Try:

> Convert 100 USD to EUR.

The agent calls `convert_to_currency` and uses its result in the answer. The conversion rate is fixed test data for demonstrating tool use, not a financial quote.

## Connection details

`config.py` passes all connection settings directly to ADK's `LiteLlm` wrapper:

```python
{
    "model": f"openai/{model_id}",
    "api_base": "https://api.tokenfactory.nebius.com/v1",
    "api_key": api_key,
}
```

The `openai/` prefix selects LiteLLM's generic OpenAI-compatible Chat Completions route. The Token Factory model ID follows the prefix unchanged. This example does not add an ADK provider or use stateful Responses API behavior.

## Offline validation

The configuration tests do not contact Token Factory or require credentials:

```bash
python -m unittest test_config.py -v
python -m compileall -q agent.py config.py test_config.py
```

## ADK web UI

To use the development UI, run `adk web` from the parent `agents` directory, then select `google-adk-tool-calling` at [localhost:8000](http://localhost:8000/).
