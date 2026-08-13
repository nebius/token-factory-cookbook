# Vercel AI SDK with Token Factory

This example uses Vercel's generic [`@ai-sdk/openai-compatible`](https://ai-sdk.dev/providers/openai-compatible-providers) package to stream a tool-calling response from Nebius Token Factory. Token Factory speaks the OpenAI-compatible Chat Completions protocol, so no native provider package or adapter is needed.

## Prerequisites

- Node.js 20 or later
- A [Token Factory API key](https://tokenfactory.nebius.com/)
- A current chat model ID from the [public model catalog](https://tokenfactory.nebius.com/api/public/models_info)

## Setup

```bash
cp example.env .env
npm install
```

Set both values in `.env`:

```dotenv
NEBIUS_API_KEY=your_token_factory_api_key
NEBIUS_MODEL=moonshotai/Kimi-K2.7-Code
```

`NEBIUS_MODEL` is required rather than silently defaulted, so a copied example does not keep using a model after it leaves the public catalog. The value above is a current tool-capable model as of August 13, 2026; check the catalog before running the example later.

## Run

```bash
npm run check
npm start
```

The example asks the model to call a typed local weather tool, executes it, and streams the final text to stdout. It uses the canonical `https://api.tokenfactory.nebius.com/v1` base URL and the provider's `chatModel()` method.

## API scope

This recipe uses Chat Completions. It does not use response persistence, `previous_response_id`, or other stateful Responses API behavior.
