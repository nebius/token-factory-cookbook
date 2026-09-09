# Cherry Studio with Nebius Token Factory

Cherry Studio already supports custom OpenAI-compatible providers. This recipe configures its existing **OpenAI Chat Completions** endpoint for Token Factory. It does not add a provider adapter or enable stateful Responses behavior.

Cherry Studio stores custom providers in its application database, so [`config.json`](config.json) is a reviewable reference manifest—not a file to import into the application. Follow the UI steps below.

## Prerequisites

- [Cherry Studio](https://github.com/CherryHQ/cherry-studio) installed
- a [Token Factory API key](https://tokenfactory.nebius.com/project/api-keys)

## Add the provider

1. Open **Settings → Model Services**.
2. Select **Add Provider** (`+`), then **Add Custom Provider**.
3. Enter:

   | Field                              | Value                                    |
   | ---------------------------------- | ---------------------------------------- |
   | Provider name                      | `Nebius Token Factory`                   |
   | API key                            | Your Token Factory key                   |
   | OpenAI / Chat Completions Base URL | `https://api.tokenfactory.nebius.com/v1` |

4. Keep **OpenAI / Chat Completions** selected as the default text endpoint.
5. Leave **OpenAI Responses** under **More Endpoints** empty. Token Factory's current Responses surface is stateless Stage 1 and is not the default wire contract for this recipe.
6. Save the provider.

Cherry Studio previews the final Chat Completions request as:

```text
https://api.tokenfactory.nebius.com/v1/chat/completions
```

Do not paste the full `/chat/completions` path into the Base URL field; Cherry Studio appends it.

## Discover and add models

1. Select the new **Nebius Token Factory** provider.
2. Choose **Get model list** / **Pull models**.
3. Cherry Studio calls `GET https://api.tokenfactory.nebius.com/v1/models` with the configured bearer key.
4. Select a current coding model and apply the changes. This recipe was checked with `moonshotai/Kimi-K2.7-Code`.
5. If you add the model manually instead, use the exact raw model ID and set its chat protocol/endpoint type to **OpenAI Chat Completions**. Do not prepend `openai/` or `nebius/`.
6. Enable the provider, choose the model in a chat, and send a small prompt.

Model availability changes independently of Cherry Studio. Prefer **Get model list** over copying a static catalog, and re-pull before relying on a model in a durable workflow.

## Scope

This setup covers Token Factory's OpenAI-compatible Chat Completions path, including normal Cherry Studio chat and model features supported by the selected model.

It deliberately does not configure Cherry Studio's separate **OpenAI Responses** endpoint. Do not infer support for `previous_response_id`, server-side conversation chaining, or replay of prior response output/reasoning items from Cherry Studio's ability to speak that protocol to other providers.

## Validate the reference offline

The reference manifest contains no API key. Validate it with Node's built-in tools:

```bash
node validate-config.mjs
node --test validate-config.test.mjs
```

The checks make no network calls. They verify the provider name, canonical Base URL, Chat Completions default and model endpoint, derived `/chat/completions` and `/models` routes, raw model ID, absence of a Responses endpoint, and absence of stored secrets.

## Troubleshooting

### 401 Unauthorized

Open the provider's authentication section and replace the API key with a current Token Factory key. A key is stored by Cherry Studio locally; never add it to `config.json`, source control, screenshots, or support logs.

### 404 or wrong host

The Base URL must be exactly `https://api.tokenfactory.nebius.com/v1`. Retired `api.studio.nebius.*` hosts are not valid. Do not omit `/v1`, and do not append `/chat/completions` or `/models` yourself.

### Get model list fails

Confirm the provider has an enabled API key and the Chat Completions Base URL is set. The generic Cherry Studio model fetcher derives `/models` from that Base URL and sends bearer authentication. You can compare the upstream response directly:

```bash
curl -sS https://api.tokenfactory.nebius.com/v1/models \
  -H "Authorization: Bearer $NEBIUS_API_KEY"
```

### Model not found

Pull the model list again. If the model was removed, select another current model suitable for coding and tool use. Keep the provider-owned model ID unchanged.

### Requests unexpectedly use Responses

Edit the provider and confirm **OpenAI / Chat Completions** is the default endpoint. Remove any OpenAI Responses Base URL, then edit the model and ensure its endpoint type contains only **OpenAI Chat Completions**.

## Evidence checked

The recipe follows Cherry Studio's current public source behavior:

- custom providers expose independent OpenAI Chat Completions and OpenAI Responses URL fields;
- Chat Completions is the default when it is the configured text endpoint;
- request previews append `/chat/completions` to the configured API root; and
- the generic model fetcher appends `/models` and sends bearer authentication.

No Cherry Studio provider preset or adapter is required.

## References

- [Cherry Studio repository](https://github.com/CherryHQ/cherry-studio)
- [Token Factory inference quickstart](https://docs.tokenfactory.nebius.com/inference/quickstart)
- [Token Factory API reference](https://docs.tokenfactory.nebius.com/api-reference/inference/create-chat-completion)
