# pi coding agent + Nebius Token Factory

[pi](https://github.com/earendil-works/pi) is a terminal coding agent with a built-in custom-provider configuration path. Nebius Token Factory works through pi's existing `openai-completions` API mode, so no provider adapter or extension is required.

This recipe uses OpenAI-compatible Chat Completions. It does not select pi's separate `openai-responses` mode.

## Prerequisites

- Node.js and the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent).
- A Nebius Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com/).
- A model available to your Token Factory account. The sample uses the current `zai-org/GLM-5.1`; verify it, or choose another tool-capable model, in the [live model catalog](https://tokenfactory.nebius.com/model-catalog.md).

## 1. Install pi

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

## 2. Configure the provider

Pi reads custom providers from `~/.pi/agent/models.json`. On a fresh setup, copy [`models.example.json`](models.example.json) there. If the file already exists, merge the `nebius-token-factory` entry into its existing `providers` object instead of replacing the file.

```bash
mkdir -p ~/.pi/agent
cp models.example.json ~/.pi/agent/models.json
```

The important fields are:

- `baseUrl`: Token Factory's canonical API root, including `/v1`.
- `apiKey`: `$NEBIUS_API_KEY`, which tells pi to resolve the environment variable at request time. Do not remove the `$`.
- `api`: `openai-completions`, pi's Chat Completions compatibility mode.
- `models`: explicit model entries; pi does not copy Token Factory's catalog into this local file automatically.

The compatibility overrides keep the baseline request aligned with Token Factory's Chat Completions schema: use `system` rather than `developer`, send `max_tokens` rather than `max_completion_tokens`, and do not request OpenAI long-cache retention.

## 3. Set the API key

```bash
export NEBIUS_API_KEY=your_key_here
```

Keep the key in your shell or secret manager. Do not paste a working key into `models.json` or commit one to source control.

## 4. Select the model

Confirm pi loaded the custom entry:

```bash
pi --list-models "GLM-5.1"
```

Then start pi in the project you want it to work on:

```bash
pi --provider nebius-token-factory --model zai-org/GLM-5.1
```

You can also select the model from `/model` in an interactive pi session.

The sample keeps pi's extended-thinking controls off and declares text input only. That is the conservative coding-agent baseline validated by this recipe. Tool calling remains available because pi's normal coding tools use the Chat Completions `tools` field. Enable model-specific reasoning controls or image input only after validating the exact current model and route.

## Validate the sample offline

The included test checks the provider schema, canonical URL, environment-key reference, current model entry, compatibility overrides, and absence of Responses mode without making an API request:

```bash
cd integrations/pi
python3 -m unittest -v test_recipe.py
```

## Troubleshooting

- **Model does not appear** — ensure the file is exactly `~/.pi/agent/models.json`, export `NEBIUS_API_KEY` in the shell that starts pi, then reopen `/model`. Pi reloads the file when the model selector opens.
- **Authentication error** — the JSON value must be `"$NEBIUS_API_KEY"`, including the `$`. `"NEBIUS_API_KEY"` is treated as a literal key.
- **404 / model not found** — compare the exact, case-sensitive model ID with the live catalog and the models available to your key. Update the single model entry rather than copying a static catalog.
- **Request mentions `developer` or `max_completion_tokens`** — confirm the `compat` object from the sample is present and nested under `nebius-token-factory`.
- **Wrong endpoint** — use `https://api.tokenfactory.nebius.com/v1`. Do not append `/chat/completions`; pi adds the route.
- **Tool calls fail** — first test a plain prompt, then verify that the selected model currently advertises function calling. Tool support is model-specific even when the API route is compatible.
- **Context or cost display looks wrong** — model metadata changes over time. Recheck the live catalog before changing `contextWindow`; pi's cost display is zero unless you add current rates, so use Token Factory billing as the source of truth.
- **You need Responses-specific features** — this recipe intentionally uses Chat Completions. Token Factory's Responses-compatible surface is stateless and requires separate model/workflow validation; changing `api` is not a drop-in persistence guarantee.

## Resources

- [pi custom models documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md)
- [pi provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md)
- [Token Factory model catalog](https://tokenfactory.nebius.com/model-catalog.md)
- [Token Factory Chat Completions API](https://docs.tokenfactory.nebius.com/api-reference/inference/chat-completion)
