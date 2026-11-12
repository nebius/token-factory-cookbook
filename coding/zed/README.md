# Zed with Nebius Token Factory

Use Nebius Token Factory for Zed-owned AI features through Zed's existing
[OpenAI-compatible provider](https://zed.dev/docs/ai/use-api-access#openai-compatible).
No Zed extension, native provider, or Token Factory adapter is required.

This recipe configures `moonshotai/Kimi-K3` over the OpenAI Chat Completions
protocol. It applies to the Zed Agent, Inline Assistant, commit-message generation,
thread summaries, and similar model-backed Zed features. It does not configure
External Agents, Terminal Threads, or Edit Prediction; those are separate Zed
surfaces with their own model access and authentication.

## Prerequisites

- A current [Zed](https://zed.dev/download) installation
- A [Nebius Token Factory API key](https://tokenfactory.nebius.com/)
- Python 3.11 or newer for the optional offline validator

## Configure the provider

Open Zed's Agent Settings from the command palette with `agent: open settings`.
Under **LLM Providers**, choose **Add Provider**, then select an OpenAI-compatible
provider and enter:

| Field | Value |
| --- | --- |
| Provider ID / name | `nebius` |
| API URL | `https://api.tokenfactory.nebius.com/v1` |
| Model ID | `moonshotai/Kimi-K3` |
| Context window | `1000000` |
| Supports tools | On |
| Supports images | On |
| Supports `/chat/completions` | On |
| Supports parallel tool calls | Off |
| Supports prompt cache key | Off |
| Interleaved reasoning | On |
| Uses `max_tokens` | Off |

The provider ID is significant. Zed converts it to upper snake case and appends
`_API_KEY`; `nebius` therefore reads `NEBIUS_API_KEY`.

Enter the Token Factory key in Zed's provider UI to store it in the local system
keychain. Alternatively, start Zed from an environment that contains the key:

```bash
export NEBIUS_API_KEY="your-token-factory-api-key"
zed .
```

Do not put the key in `settings.json`.

## Merge the maintained settings

The UI writes equivalent settings. For a reviewable manual setup, open your Zed
settings file with `zed: open settings file` and merge the contents of
`settings.json` into your existing top-level JSON object. Do not replace unrelated
editor settings.

The important protocol lock is:

```json
"capabilities": {
  "chat_completions": true,
  "interleaved_reasoning": true,
  "max_tokens_parameter": false
}
```

With `chat_completions: true`, current Zed appends `/chat/completions` to the
configured API URL. Setting it to `false` switches Zed to `/responses`, which is
outside this recipe. `interleaved_reasoning` allows reasoning-capable chat models
to round-trip the dedicated `reasoning_content` field. Keeping
`max_tokens_parameter: false` uses `max_completion_tokens`, which Token Factory's
Chat Completions API accepts.

## Select and use the model

The settings fragment makes Kimi K3 the default Zed model. You can also select
**Nebius Token Factory · Kimi K3** from the model picker in the Agent Panel.

Start with a low-risk prompt and approve tool actions deliberately. Provider
configuration does not change Zed's tool-permission policy.

## Validate offline

The validator parses the settings without launching Zed or contacting Token
Factory. It checks the exact schema subset, base URL, model, context, provider-to-key
mapping, default-model reference, secret exclusion, and Chat Completions capability.

```bash
python validate_settings.py
python -m venv .venv
.venv/bin/pip install -r requirements-test.txt
.venv/bin/pytest -q
```

## Limitations

- This recipe covers Zed-owned AI features only. External Agents and Terminal
  Threads are separate processes and do not inherit this provider.
- Edit Prediction uses a separate configuration and the legacy OpenAI
  `/v1/completions` format. Kimi K3 is not configured here as a fill-in-the-middle
  edit-prediction model.
- The current model is pinned because its 1M context, vision, tools, and reasoning
  declarations are model-specific. When changing models, update and validate all
  of those fields together.
- `parallel_tool_calls` and `prompt_cache_key` remain off because this recipe does
  not claim those optional Zed request features for Token Factory.
- Zed's OpenAI-compatible provider rate-limits itself to four concurrent requests.
- API access is initialized in the local Zed app. For SSH and dev-container
  projects, keychain credentials and provider environment variables come from the
  local Zed process, not the remote shell.

## Troubleshooting

### Zed asks for an API key

Enter it through the `nebius` provider UI, or make sure `NEBIUS_API_KEY` is in the
environment of the Zed process and restart Zed. A key exported only in an embedded
or remote terminal does not automatically reach the local app.

### `401` or `403`

Create or rotate the key in Token Factory, reset the provider credential in Zed,
and enter the new value. Confirm the API URL still ends in `/v1`.

### `404` or request reaches `/responses`

Keep the base URL at `https://api.tokenfactory.nebius.com/v1` and
`capabilities.chat_completions` set to `true`. Do not append
`/chat/completions` yourself; Zed appends it. A false capability sends the request
to the Responses endpoint instead.

### Model not found

Confirm the exact current model ID in the authenticated Token Factory model catalog.
If Kimi K3 has been retired, update the model ID, context window, capabilities,
default-model reference, and validator together instead of changing only the name.

### Tools or images fail

Check that the model remains advertised with those capabilities in Token Factory.
If the selected replacement model lacks either feature, turn the corresponding Zed
capability off so the UI does not offer unsupported inputs or tools.

## Documentation gap audited

Token Factory's public integrations overview lists **Zed** under Coding Assistants,
but as of this audit the label has no linked setup page or configuration details.
This first-party cookbook recipe fills that onboarding gap without adding or
duplicating provider code in Zed.
