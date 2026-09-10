# Trace Nebius Token Factory with Respan Gateway

Route Token Factory Chat Completions through
[Respan](https://www.respan.ai/) (formerly Keywords AI) using Respan's existing
[Custom / Self-hosted provider](https://www.respan.ai/docs/integrations/gateway/model-providers/custom).
The gateway automatically records latency, token, cost, and error traces, so this
path needs neither a Token Factory adapter nor the Respan tracing SDK.

This recipe uses two trust boundaries:

1. Respan stores a Token Factory provider credential and proxies the request.
2. Your application authenticates to Respan using only `RESPAN_API_KEY`.

It is deliberately limited to OpenAI-compatible Chat Completions. Respan has a
separate Responses route, but arbitrary custom-provider Responses behavior is not
validated here.

## Prerequisites

- Python 3.11 or newer
- [`uv`](https://docs.astral.sh/uv/getting-started/installation/)
- A [Nebius Token Factory API key](https://tokenfactory.nebius.com/)
- A [Respan account and API key](https://platform.respan.ai/platform/api/api-keys)

## Register Token Factory in Respan

The checked-in `provider-config.example.json` is an offline-review checklist, not
an importable payload. Configure its values in the Respan UI:

1. Open Respan's [Providers page](https://platform.respan.ai/platform/api/providers)
   and choose **Add Custom Provider**.
2. Set the name to `Nebius Token Factory`.
3. Select the OpenAI-compatible protocol.
4. Set the provider base URL to exactly
   `https://api.tokenfactory.nebius.com/v1`.
5. Paste your `NEBIUS_API_KEY` into Respan's provider credential field. Do not put
   it in this recipe's `.env`; the application does not need the upstream key.
6. Open Respan's [Models page](https://platform.respan.ai/platform/models), add
   `moonshotai/Kimi-K3`, and associate it with the custom Token Factory provider.
7. Use Respan's provider/model test before sending application traffic.

Kimi K3 is the model validated by this recipe. If Token Factory replaces it,
update the Respan model registration, example config, code constant, documentation,
and tests together after confirming the current catalog.

## Install and configure

From this directory:

```bash
uv venv
uv pip install -r requirements.txt -r requirements-test.txt
cp .env.example .env
```

Edit `.env`:

```dotenv
RESPAN_API_KEY=your-respan-api-key
RESPAN_MODEL=moonshotai/Kimi-K3
RESPAN_LOG_CONTENT=false
```

Keep `RESPAN_LOG_CONTENT=false` until your data owner has approved prompt and
completion retention in Respan. Then validate locally without a network request:

```bash
uv run python respan_gateway.py --check
```

## Run

```bash
uv run python respan_gateway.py --prompt "Explain tracing in one sentence."
```

The application sends `POST https://api.respan.ai/api/chat/completions` with the
registered raw model ID. Respan authenticates the upstream request using the Token
Factory credential stored in Provider settings, then exposes the request as a
trace in its Logs view.

## Privacy and production review

Gateway mode places Respan in the inference data path. Prompts and completions
transit Respan before reaching the canonical Token Factory endpoint, and the
Token Factory credential is stored in Respan Provider settings. Review your data
classification, DPA, retention, region, access-control, and incident requirements
before production use; do not send secrets, personal data, or regulated content
until that review is complete.

This recipe defaults to `disable_log=true`, which Respan documents as recording
metrics while omitting input/output from the log. It does **not** prevent request
content from transiting the gateway. Setting `RESPAN_LOG_CONTENT=true` changes the
request to `disable_log=false`, allowing content to appear in traces subject to
your Respan retention controls.

Use separate Respan API keys for development and production, restrict access to
Provider settings, and rotate both Respan and Token Factory credentials after any
suspected exposure. Gateway mode may add latency and a third-party dependency;
test timeouts and failure behavior for your workload.

## Offline validation

```bash
uv run pytest -q
uvx ruff check respan_gateway.py test_respan_gateway.py
uvx ruff format --check respan_gateway.py test_respan_gateway.py
```

The mocked transport test executes the real OpenAI Python client and asserts:

- `POST /api/chat/completions`, never `/responses`
- Respan bearer authentication at the application boundary
- the exact `moonshotai/Kimi-K3` model registration
- the canonical Token Factory URL in the provider checklist
- content logging disabled by default

## Troubleshooting

### Respan reports a provider credential error

The local process needs `RESPAN_API_KEY`, while the Respan custom provider needs
the separate `NEBIUS_API_KEY`. Confirm both keys are in the correct location and
that the provider test succeeds. Do not pass the Token Factory key to the gateway
as application bearer authentication.

### Model not found

The application model must exactly match the custom model registered in Respan.
Confirm `moonshotai/Kimi-K3` is still available in Token Factory, then check its
case and provider association in Respan's Models page.

### The request reaches `/api/responses`

Use `client.chat.completions.create`, as shown here. Do not replace it with
`client.responses.create`; this recipe has not validated custom Token Factory
routing through Respan's Responses endpoint.

### Traces contain no prompt or completion

That is the expected privacy-first default. Metrics remain available while
`RESPAN_LOG_CONTENT=false`. Opt in only after completing the data review above.

### Duplicate traces

Gateway calls are automatically traced. Do not add Respan's OpenAI instrumentation
to this small gateway client unless you intentionally want separate client-side
spans and have verified deduplication.

## Existing cookbook Keywords AI hook

`rag/support-agent-weaviate` contains an older optional `MonitoringAgent` that
manually posts a second request log to the legacy `api.keywordsai.co` endpoint and
estimates tokens by splitting text. It does not proxy Token Factory traffic,
capture the actual provider response metadata, or represent current Respan gateway
onboarding. This recipe leaves that application untouched; migrating or removing
its legacy hook should be reviewed as a separate app-specific cleanup.
