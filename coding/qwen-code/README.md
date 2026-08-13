# Qwen Code with Nebius Token Factory

Qwen Code already supports custom OpenAI-compatible providers. This recipe configures that existing path for Token Factory's **Chat Completions** interface; it does not add a provider preset, adapter, or stateful Responses integration.

## Prerequisites

- Node.js 22 or newer
- [Qwen Code](https://github.com/QwenLM/qwen-code)
- a [Token Factory API key](https://tokenfactory.nebius.com/project/api-keys)

Install Qwen Code if needed:

```bash
npm install -g @qwen-code/qwen-code@latest
```

## Configure

1. Export your key in the shell. Keep it out of `settings.json`:

   ```bash
   export NEBIUS_API_KEY="your-token-factory-key"
   ```

2. Merge [`settings.json`](settings.json) into `~/.qwen/settings.json`. If you do not have a Qwen Code settings file yet:

   ```bash
   mkdir -p ~/.qwen
   cp settings.json ~/.qwen/settings.json
   ```

   If the file already exists, add the `modelProviders.openai` entry and preserve your other settings. Qwen Code identifies models by `id` plus `baseUrl`, so avoid adding the same pair twice.

3. Start Qwen Code inside a repository:

   ```bash
   cd /path/to/your/project
   qwen
   ```

4. Run `/doctor` to inspect configuration. Use `/model` and select **Kimi K2.7 Code (Nebius Token Factory)** if another model is active.

The model ID in this recipe was present in the public Token Factory catalog when the recipe was tested. Model availability changes: check `GET https://api.tokenfactory.nebius.com/v1/models` and replace both the provider `id` and `model.name` together if it is no longer returned.

## What the configuration means

- `modelProviders.openai` selects Qwen Code's existing OpenAI-compatible protocol, implemented with the official OpenAI Node SDK.
- `baseUrl` includes `/v1`, so Qwen Code sends Chat Completions requests to `POST /v1/chat/completions`.
- `envKey` tells Qwen Code to read the API key from `NEBIUS_API_KEY` at runtime.
- `id` is the raw Token Factory model ID. Do not prepend `openai/` or `nebius/`.
- `security.auth.selectedType: "openai"` selects the OpenAI-compatible protocol. It does not mean requests go to OpenAI; the configured `baseUrl` owns the route.

This setup intentionally uses Chat Completions. It does not enable `previous_response_id`, server-side conversation chaining, or other stateful Responses behavior.

## Validate offline

Run the included configuration checks with Node's built-in test runner:

```bash
node validate-config.mjs
node --test validate-config.test.mjs
```

These checks make no network calls and do not require an API key. They assert the canonical URL, external key reference, raw model ID, selected protocol, and absence of secrets in the checked-in settings.

## Troubleshooting

### Qwen Code asks you to authenticate again

Confirm `NEBIUS_API_KEY` is exported in the same shell that starts `qwen`, then run `/auth` and choose **Custom Provider → OpenAI-compatible** or restart after copying the settings file.

### The model does not appear in `/model`

Use the bare array form shown in this recipe:

```json
"modelProviders": { "openai": [{ "id": "..." }] }
```

Older wrapped shapes such as `{ "protocol": "openai", "models": [...] }` are skipped by current Qwen Code. Also confirm `model.name` exactly matches the configured `id`.

### 401 Unauthorized

Check that the key came from Token Factory, `envKey` is `NEBIUS_API_KEY`, and the environment variable is not empty. Do not paste the key into this repository or commit it in `settings.json`.

### 404 or requests go to the wrong host

The base URL must be exactly:

```text
https://api.tokenfactory.nebius.com/v1
```

Do not use a retired AI Studio hostname, omit `/v1`, or append `/chat/completions` to `baseUrl`; Qwen Code appends the Chat Completions route itself.

### Model not found

Query the current catalog and update both occurrences of the model ID:

```bash
curl -sS https://api.tokenfactory.nebius.com/v1/models \
  -H "Authorization: Bearer $NEBIUS_API_KEY"
```

Choose a model suitable for coding and tool use, then keep the exact provider-owned ID unchanged.

## References

- [Qwen Code custom-provider authentication](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/auth/)
- [Qwen Code model-provider configuration](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/model-providers/)
- [Token Factory inference quickstart](https://docs.tokenfactory.nebius.com/inference/quickstart)
