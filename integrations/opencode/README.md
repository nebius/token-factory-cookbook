# OpenCode with Nebius Token Factory

OpenCode already discovers Nebius Token Factory through
[Models.dev](https://models.dev). No custom provider or proxy is required:
OpenCode routes the catalog entry through `@ai-sdk/openai-compatible` to the
Chat Completions API at `https://api.tokenfactory.nebius.com/v1`.

This recipe was verified against OpenCode's `dev` branch and the live
Models.dev catalog on August 13, 2026. Model availability changes, so use
OpenCode's model picker or check the catalog instead of copying a long-lived
model list.

## Prerequisites

- An [OpenCode installation](https://opencode.ai/docs/)
- A Token Factory account and API key from the
  [Token Factory console](https://tokenfactory.nebius.com/)

## Connect

1. Start OpenCode and enter `/connect`.
2. Search for **Nebius Token Factory**.
3. Paste your Token Factory API key.
4. Enter `/models`, choose **Nebius Token Factory**, and select an active model.

OpenCode stores credentials in its user data directory. Do not put an API key
in a project file or commit it to source control. As a non-interactive
alternative, export `NEBIUS_API_KEY` in the process that starts OpenCode.

## Run a smoke task

After connecting, select a tool-capable model in `/models` and ask OpenCode to
inspect a small repository and run its tests. For a one-shot CLI smoke task,
pass the provider/model pair explicitly:

```bash
opencode run \
  --model nebius/moonshotai/Kimi-K2.7-Code \
  "Run the smallest relevant test and summarize the result."
```

The first slash separates the Models.dev provider ID (`nebius`) from the full
Token Factory model ID (`moonshotai/Kimi-K2.7-Code`). Re-run `/models` if that
example ID is no longer listed.

## Verify the catalog contract

The included checker validates the existing integration rather than creating
another provider. It checks the canonical endpoint, API-key environment name,
OpenAI-compatible client, active status, text I/O, and tool support:

```bash
python integrations/opencode/validate_provider.py \
  --model moonshotai/Kimi-K2.7-Code
```

Use `--catalog path/to/api.json` to validate a saved Models.dev snapshot. The
default fetches `https://models.dev/api.json`.

## API boundary

This integration uses OpenAI-compatible Chat Completions. Do not change the
provider package to `@ai-sdk/openai` merely to select the Responses API. Token
Factory Responses support has a separate, stateless compatibility contract,
while Models.dev currently declares this provider as
`@ai-sdk/openai-compatible`.

## Troubleshooting

- **Nebius Token Factory is missing from `/connect`:** update OpenCode, then
  verify the Models.dev catalog with the command above.
- **401 response:** reconnect the provider or check that `NEBIUS_API_KEY` is
  visible to the OpenCode process.
- **Model not found:** use `/models` to choose an active model. Do not keep a
  removed or deprecated model ID in project configuration.
- **Tool calls fail:** choose a catalog model whose `tool_call` field is true
  and validate that exact ID with `--model`.
- **Base URL includes `/chat/completions`:** remove that suffix. The catalog
  base URL must stop at `/v1`; OpenCode appends the Chat Completions route.

## What this recipe does not add

It does not add a native OpenCode provider, copy Token Factory's model list,
or introduce a proxy. Provider metadata and models remain owned by Models.dev,
so catalog fixes should be made there once and then consumed by OpenCode.
