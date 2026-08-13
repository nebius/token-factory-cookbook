# OpenClaw + Nebius Token Factory

[OpenClaw](https://openclaw.ai/) can use custom OpenAI-compatible model
providers. This recipe registers
[Nebius Token Factory](https://tokenfactory.nebius.com/) as a custom provider,
keeps the API key outside the configuration file, and shows how to verify the
selected model before starting the gateway.

> **Last verified:** 2026-08-13 against the Token Factory public model catalog
> and OpenClaw `2026.7.1-2`. The validation in this repository is offline; it
> does not make a paid inference request.

## Prerequisites

- A working [OpenClaw installation](https://docs.openclaw.ai/start/getting-started)
- A Token Factory account and API key; see [Getting Started](../../getting-started.md)
- A model available to your Token Factory account

## 1. Keep the API key out of configuration

Export the key in the environment that starts the OpenClaw gateway:

```bash
export NEBIUS_API_KEY="your-token-factory-api-key"
```

For a persistent installation, set `NEBIUS_API_KEY` with your service manager
or secret store. Do not paste the key into `openclaw.json`, commit it, or put it
in shell history. The included [`.env.example`](.env.example) is a
variable-name reference, not a file to fill in and commit.

## 2. Register Token Factory

Merge the contents of
[`openclaw.example.json`](openclaw.example.json) into
`~/.openclaw/openclaw.json`. If you already have provider or agent settings,
preserve them; do not replace the whole file blindly.

The important provider fields are:

```json
{
  "baseUrl": "https://api.tokenfactory.nebius.com/v1",
  "apiKey": "${NEBIUS_API_KEY}",
  "api": "openai-completions"
}
```

- Keep `/v1` in `baseUrl`.
- Use `openai-completions` for Token Factory's OpenAI-compatible Chat
  Completions path.
- Model references have the form `nebius-token-factory/<org>/<model>`.
  OpenClaw removes the provider prefix and sends the remaining `<org>/<model>`
  ID to Token Factory.

The example selects:

```text
nebius-token-factory/moonshotai/Kimi-K2.6
```

## 3. Verify configuration before starting the gateway

Run OpenClaw's configuration and model diagnostics:

```bash
openclaw config validate
openclaw models status
openclaw models list --provider nebius-token-factory
```

These commands verify the local schema and model registration. OpenClaw's
model-list command is read-only and does not call the provider, so it does not
prove account access or live inference readiness. Token Factory's
[public model catalog](https://tokenfactory.nebius.com/api/public/models_info)
is the lifecycle source to check before choosing a different model.

Then restart the gateway and open a client:

```bash
openclaw gateway restart
openclaw dashboard
# or: openclaw tui
```

For a first request, use a low token limit and inspect the response before
enabling the model in unattended agents.

## Model lifecycle note

These example IDs were present with `active` status in the public catalog when
this recipe was last verified:

| Model | Token Factory model ID |
| --- | --- |
| Kimi K2.6 | `moonshotai/Kimi-K2.6` |
| DeepSeek V4 Flash | `deepseek-ai/DeepSeek-V4-Flash` |
| GLM 5.1 | `zai-org/GLM-5.1` |

Kimi K2.6 and GLM 5.1 both had public `active` status on 2026-08-13. This recipe
retains both IDs and does not infer a deprecation or replacement from an
unconfirmed lifecycle signal. Re-check the public catalog and your account
before deploying or changing a production default; use the exact case-sensitive
ID returned there.

## Updating the default model

1. Confirm the model is in the current catalog and available to your account.
2. Add its exact ID under `models.providers.nebius-token-factory.models`.
3. Set `agents.defaults.model.primary` to `nebius-token-factory/<exact-model-id>`.
4. Re-run `openclaw config validate` and `openclaw models status`.

Do not infer a replacement from an unconfirmed lifecycle signal. Wait for the
public lifecycle state or an official migration path.

## Troubleshooting

- **Missing environment variable** — export `NEBIUS_API_KEY` in the same
  environment that launches the gateway. A desktop shell and a system service
  may not share environment variables.
- **401 Unauthorized** — verify the key is active and that OpenClaw resolves
  `${NEBIUS_API_KEY}` rather than storing a literal placeholder.
- **404 / model not found** — copy the exact case-sensitive model ID from the
  current catalog and confirm it is available to your account.
- **Wrong route** — `baseUrl` must be exactly
  `https://api.tokenfactory.nebius.com/v1`; do not append `/chat/completions`.
- **Provider appears but model does not** — a custom model must be registered in
  `models.providers.nebius-token-factory.models`; adding only an alias under
  `agents.defaults.models` does not register it.
- **Existing configuration disappears** — restore your backup and merge the
  provider block instead of replacing `openclaw.json`.

## Offline validation for contributors

From the repository root:

```bash
python -m unittest integrations.openclaw.test_recipe
```

The test checks the JSON example, canonical endpoint, environment-backed secret
reference, provider/model IDs, lifecycle note, and common secret/configuration
regressions. It does not require an API key or network access.

## Resources

- [OpenClaw custom providers](https://docs.openclaw.ai/concepts/model-providers#providers-via-modelsproviders-custombase-url)
- [OpenClaw models CLI](https://docs.openclaw.ai/concepts/models)
- [Token Factory documentation](https://docs.tokenfactory.nebius.com/)
- [Token Factory public model catalog](https://tokenfactory.nebius.com/api/public/models_info)
- [Cookbook Getting Started](../../getting-started.md)
