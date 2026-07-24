# Universal Deep Research (Nebius Token Factory) — Agent

This agent demonstrates a multi‑step research pipeline powered by Nebius Token Factory models (OpenAI‑compatible) with a FastAPI backend and a Next.js frontend. It uses the model `moonshotai/Kimi-K2.6` by default.

- Source app: https://github.com/demianarc/nebiusaistudiodeepresearch
- Cookbook context: add this folder under `agents/`.
- Nebius Token Factory Cookbook: https://github.com/nebius/token-factory-cookbook

## What it does
- Plans search queries, fetches web results (Tavily), analyzes content, and generates a structured Markdown report using Nebius LLMs.
- Streams progress and a final report to the UI.

## Prerequisites
- Nebius Token Factory account and API key (`NEBIUS_API_KEY`)
- Python 3.9+ (3.10+ recommended)
- Node.js 18+

## Quickstart

1) Clone the app
```bash
git clone https://github.com/demianarc/nebiusaistudiodeepresearch udr-nebius
cd udr-nebius
```

2) Backend setup
```bash
cd backend
python3 -m venv venv && . venv/bin/activate
pip install -r requirements.txt
cp env.example .env
# Required (no quotes):
# NEBIUS_API_KEY=your-nebius-api-key
# DEFAULT_MODEL=nebius-kimi-k2
# Optional (CORS for frontend):
# FRONTEND_URL=http://localhost:3004
# OpenAI-compatible Nebius base URL + model (already defaulted in this edition):
# FRAME_BASE_URL=https://api.tokenfactory.nebius.com/v1/
# FRAME_MODEL=moonshotai/Kimi-K2.6
# Optional (web search):
# echo "<your-tavily-key>" > tavily_api.txt
./launch_server.sh
```

3) Frontend setup
```bash
cd ../frontend
cp env.example .env.local
# Connect to backend and use v1 endpoint
sed -i '' 's#^NEXT_PUBLIC_BACKEND_BASE_URL=.*#NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost#' .env.local
sed -i '' 's#^NEXT_PUBLIC_BACKEND_PORT=.*#NEXT_PUBLIC_BACKEND_PORT=8000#' .env.local
sed -i '' 's#^NEXT_PUBLIC_API_VERSION=.*#NEXT_PUBLIC_API_VERSION=v1#' .env.local
sed -i '' 's#^NEXT_PUBLIC_ENABLE_V2_API=.*#NEXT_PUBLIC_ENABLE_V2_API=false#' .env.local
sed -i '' 's#^NEXT_PUBLIC_DRY_RUN=.*#NEXT_PUBLIC_DRY_RUN=false#' .env.local
npm install
npm run dev -- -p 3004
```

4) Use the UI
Open http://localhost:3004 and enter a prompt (e.g., “Tell me everything about Nebius Token Factory”).

## Notes
- The backend uses an OpenAI‑compatible client pointed to `https://api.tokenfactory.nebius.com/v1/`.
- Default model is `moonshotai/Kimi-K2.6`.
- No secrets are committed; `.env*` and `*_api.txt` files are ignored.
- This integrates the original NVIDIA research prototype with Nebius models; credits retained.

## References
- Nebius Token Factory Cookbook: https://github.com/nebius/token-factory-cookbook
