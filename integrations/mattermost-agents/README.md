# Mattermost Agents + Nebius Token Factory

[Mattermost Agents](https://github.com/mattermost/mattermost-plugin-agents) can connect to Nebius Token Factory through its built-in **OpenAI Compatible** service. No Mattermost provider plugin or custom adapter is required.

This recipe uses the Chat Completions compatibility path. Mattermost's **Use Responses API** setting must therefore be off.

## Prerequisites

- A Mattermost deployment with the Agents plugin installed and enabled.
- A Nebius Token Factory API key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com/).
- A model available to your Token Factory account. The sample uses `moonshotai/Kimi-K2.7-Code`; verify it, or select another model, from the [live model catalog](https://tokenfactory.nebius.com/model-catalog.md).

## 1. Add the Token Factory service

In Mattermost, open **System Console > Plugins > Agents**, select **Add a Service**, and enter:

| Mattermost setting | Value |
| --- | --- |
| **Service name** | `Nebius Token Factory` |
| **Service type** | **OpenAI Compatible** |
| **API URL** | `https://api.tokenfactory.nebius.com/v1` |
| **API Key** | Your Token Factory API key |
| **Default Model** | `moonshotai/Kimi-K2.7-Code` or another model available to your account |
| **Use Responses API** | **Off** |

Save the service. Mattermost may fetch the model list from Token Factory after the API URL and key are present; model IDs are case-sensitive.

The accompanying [`service-config.example.json`](service-config.example.json) is a reviewable reference for these fields. It is not a complete Mattermost admin-config export and contains no working secret. Mattermost assigns service IDs and stores the configuration through its own admin interface or admin API.

## 2. Create or update an agent

Open the top-level **Agents** product page, create an agent (or edit an existing one), and select **Nebius Token Factory** as its service. Leave the agent's model override empty to inherit the service's default, or enter another exact model ID available to your account.

Start with a plain chat prompt before enabling Mattermost tools or MCP servers. Tool calling is model-sensitive; select a model whose current catalog metadata advertises `function_calling` before testing tools.

## Why `Use Responses API` is off

Mattermost routes an **OpenAI Compatible** service through Chat Completions when `Use Responses API` is `false`. Selecting Mattermost's direct **OpenAI** service is not equivalent: that service always uses the Responses API.

Token Factory exposes a stateless Responses-compatible surface for supported models, but this recipe does not validate Mattermost's Responses-specific native tools, reasoning controls, or response-state assumptions. Keep the setting off unless you have separately tested that exact model and workflow.

## Validate the sample offline

The validation test checks the documented service type, canonical URL, explicit model, secret placeholder, and Chat Completions setting without making a network request:

```bash
cd integrations/mattermost-agents
python3 -m unittest -v test_recipe.py
```

## Troubleshooting

- **401 Unauthorized** — replace `<NEBIUS_API_KEY>` with a valid key in Mattermost. Do not include quotes, the placeholder text, or the `Bearer` prefix.
- **404 / model not found** — compare the exact, case-sensitive model ID with the live catalog and the models available to your key. Model availability changes; do not guess a replacement from the model family name.
- **Requests go to `/responses`** — confirm the service type is **OpenAI Compatible**, not **OpenAI**, and that **Use Responses API** is off.
- **Wrong endpoint** — use `https://api.tokenfactory.nebius.com/v1` as the API URL. Do not append `/chat/completions`; Mattermost adds the route.
- **Tools do not run** — first confirm plain chat works, then choose a model advertising function calling. Mattermost's provider-native web search and Responses-only reasoning controls are outside this recipe.
- **Model list cannot be fetched** — verify that the Mattermost server can reach `api.tokenfactory.nebius.com` and that the API URL and key are both present. You can still enter a known, current model ID manually.

## Resources

- [Mattermost Agents provider guide](https://github.com/mattermost/mattermost-plugin-agents/blob/master/docs/providers.md)
- [Mattermost Agents admin guide](https://github.com/mattermost/mattermost-plugin-agents/blob/master/docs/admin_guide.md)
- [Token Factory model catalog](https://tokenfactory.nebius.com/model-catalog.md)
- [Token Factory API documentation](https://docs.tokenfactory.nebius.com/api-reference/inference/chat-completion)
