# OpenClaw + Nebius Token Factory

[OpenClaw](https://openclaw.ai/) is a self-hosted AI assistant that connects chat apps (WhatsApp, Telegram, Discord, and more) to LLM providers. Because [Nebius Token Factory](https://tokenfactory.nebius.com/) serves open models through an **OpenAI-compatible API**, you can point OpenClaw at Token Factory and run your agents on models like Qwen3, Llama, and DeepSeek.

## Why Token Factory?

- **OpenAI-compatible** — no special SDK, OpenClaw's built-in OpenAI provider works as-is.
- **Open models** — Qwen3, Kimi, DeepSeek, GLM and more, all behind one API key.
- **Cost control** — usage-based pricing with no infra to manage.

## Prerequisites

- A running [OpenClaw](https://docs.openclaw.ai/) instance.
- A Nebius Token Factory API key — see [Getting Started](../../getting-started.md) for how to create one.

## 1. Get your API key

Grab a key from [tokenfactory.nebius.com](https://tokenfactory.nebius.com/)

## 2. Add Token Factory as a provider

```bash
openclaw --configure
```

- Choose '**Configure Models**'
- choose '**Custom provider**'
- base url = `https://api.tokenfactory.nebius.com/v1`
- API KEY = `paste your nebius API key`
- Select **OpenAI comptible**
- model id =  `moonshotai/Kimi-K2.6`  (or any model id from Token Factory)
- End point id = **nebius-token-factory**
- model alias : leave blank
  

### Model Selection

Model IDs use the `org/model` form. A few options:

| Model | ID |
|-------|----|
| Kimi-K2.6 | `moonshotai/Kimi-K2.6` |
| DeepSeek-V4-Pro | `deepseek-ai/DeepSeek-V4-Pro` |
| GLM-5.1 | `zai-org/GLM-5.1` |

See the full catalog at [tokenfactory.nebius.com](https://tokenfactory.nebius.com/) or the [Models guides](../../models/) in this cookbook.

That's it!

## 3. Restart OpenClaw

Be sure to restart the openclaw gateway for changes to take effect.

```bash
openclaw  gateway run
# or 
openclaw  gateway restart
```

Then launch openclaw as 

```bash
# web based UI
openclaw  dashboard

# Terminal based ui
openclaw  tui
```




## Troubleshooting

- **401 Unauthorized** — check that `NEBIUS_API_KEY` is set and the provider config references it correctly.
- **404 / model not found** — verify the model ID (`org/model`, case-sensitive) and that it's available on your account.
- **Wrong endpoint** — the `base_url` must end in `/v1`; do not append `/chat/completions` yourself.

## Resources

- [OpenClaw docs](https://docs.openclaw.ai/)
- [Token Factory docs](https://docs.tokenfactory.nebius.com/)
- [Cookbook: Getting Started](../../getting-started.md)
