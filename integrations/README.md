# ⛓️ Integrations

Guides for connecting third-party tools and frameworks to [Nebius Token Factory](https://tokenfactory.nebius.com/).

Token Factory exposes an **OpenAI-compatible API** at `https://api.tokenfactory.nebius.com/v1`, so most tools that support a custom OpenAI base URL can talk to it directly.

| Integration | Description | Type |
|-------------|-------------|------|
| [OpenClaw](openclaw/) 🦞 | Run self-hosted AI agents (WhatsApp, Telegram, Discord, …) on open models served by Token Factory | Self-hosted AI assistant |
| [Tavily](tavily/) 🔍 | LLM-optimized search API for agentic research, competitive intelligence, and web-grounded agents | Search / Research |
| [Pixeltable](pixeltable/) | Multimodal AI data infrastructure with native Token Factory chat completions and embeddings | Data / RAG framework |
| [openwiki](openwiki-enterprise//) | A documentation agent that generates and maintains a Markdown knowledge base from source repositories | Documentation |
| [OpenHands Agent Canvas](openhands-agent-canvas/) 🙌 | Self-hosted control center for coding agents, running on a Nebius VM with Qwen3-32B served by Token Factory | Coding agent |
| [Tendem by Toloka](tendem-invoice-validation/) 🧾 | Confidence-gated human validation: extract invoice fields with a Token Factory vision model, escalate only the uncertain ones to a vetted human expert | Human-in-the-loop |
| [OpenEnv prompt optimization](openenv/prompt-optimization/) 🔐 | Build an [OpenEnv](https://github.com/huggingface/OpenEnv) IT access-request environment and optimize an agent's system prompt against its reward using Token Factory models as policy, reflector and judge | Agent environments / RL |

> Looking for the official integrations catalog? See [docs.tokenfactory.nebius.com/integrations](https://docs.tokenfactory.nebius.com/integrations/overview).

## 🤝 Contributing

Have an integration you'd like to add? Create a new directory under `integrations/`, add a `README.md` following the style of the existing guides, and link it in the table above.
