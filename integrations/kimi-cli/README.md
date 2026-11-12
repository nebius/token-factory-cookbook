# Kimi CLI with Nebius Token Factory

Run [Kimi CLI](https://github.com/MoonshotAI/kimi-cli) with Kimi K3 on Nebius
Token Factory through its existing OpenAI-compatible provider. This
recipe uses Kimi CLI's `openai_legacy` provider, which sends streaming requests to
the OpenAI Chat Completions endpoint. It does not add a new provider or use the
OpenAI Responses API.

The example defaults to `moonshotai/Kimi-K3`, Moonshot AI's reasoning and vision
model with a 1M-token context window. `NEBIUS_MODEL` is explicit and required so
the selected model is reviewed before every launch; this recipe rejects models
whose context and capability declarations it has not validated.

## Prerequisites

- Python 3.12 or newer
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- A [Nebius Token Factory API key](https://tokenfactory.nebius.com/)

The recipe was validated against Kimi CLI 1.49.0. Install the compatible 1.x line:

```bash
uv tool install --python 3.13 'kimi-cli>=1.49,<2'
kimi --version
```

## Configure

From this directory:

```bash
cp .env.example .env
```

Edit `.env` and set both required values:

```dotenv
NEBIUS_API_KEY=your-token-factory-api-key
NEBIUS_MODEL=moonshotai/Kimi-K3
```

Load them into the current shell and validate the configuration offline:

```bash
set -a
source .env
set +a
python kimi_token_factory.py --check
```

The launcher validates `config.template.toml`, substitutes the required model into
an ephemeral config, maps `NEBIUS_API_KEY` to the environment variable Kimi CLI's
OpenAI-compatible provider reads, and deletes the generated config on exit. The
API key is never written into the generated file.

## Run

Start an interactive session in the current project:

```bash
python kimi_token_factory.py
```

Arguments not consumed by the wrapper pass through to Kimi CLI. For example:

```bash
python kimi_token_factory.py --print "Summarize this repository"
```

Kimi CLI remains in its normal approval mode. This recipe deliberately leaves
`default_yolo = false`; review tool calls before approving them.

## Validate the recipe

The test suite is fully offline: it checks required environment variables, parses
the TOML, locks the provider to Chat Completions, verifies the canonical base URL,
and ensures no secret is stored in the config.

```bash
uv venv
uv pip install -r requirements-test.txt
uv run pytest -q
```

## Troubleshooting

### `Missing required environment`

Reload `.env` in the shell that launches the wrapper. Both `NEBIUS_API_KEY` and
`NEBIUS_MODEL` are required. This recipe requires the validated model ID
`moonshotai/Kimi-K3`.

### Authentication errors (`401` or `403`)

Create or rotate the API key in Token Factory, update `.env`, and reload it. The
wrapper overwrites ambient `OPENAI_API_KEY` and `OPENAI_BASE_URL` values for the
child process so unrelated OpenAI settings do not take precedence.

### Model not found (`404`)

Model availability can change. Confirm `moonshotai/Kimi-K3` in the Token Factory
model catalog. If it has been replaced, update the recipe's model ID, context size,
capabilities, and tests together. Do not change the provider type: Token Factory
is reached through `openai_legacy` Chat Completions.

### `Kimi CLI is not installed`

Run the installation command above and make sure the `uv` tools directory is on
`PATH` (run `uv tool update-shell` if needed).

### Search or fetch behaves differently

Kimi CLI's `SearchWeb` and hosted `FetchURL` services are exclusive to the Kimi
Code platform. With Token Factory, `SearchWeb` is unavailable and `FetchURL` falls
back to local fetching. This does not affect shell, file, agent, or other local
tools.

## How the integration works

Kimi CLI already supports arbitrary OpenAI-compatible endpoints. The essential
configuration is:

```toml
[providers.token-factory]
type = "openai_legacy"
base_url = "https://api.tokenfactory.nebius.com/v1"
api_key = "overridden-by-OPENAI_API_KEY"
reasoning_key = "reasoning_content"
```

`openai_legacy` is Kimi CLI's name for the Chat Completions protocol. The separate
`openai_responses` provider is intentionally not used by this recipe.
