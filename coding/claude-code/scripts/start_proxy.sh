#!/usr/bin/env bash
# Start the local LiteLLM proxy that translates Claude Code's Anthropic Messages
# requests into Token Factory chat completions. Run from the recipe folder:
#
#   ./scripts/start_proxy.sh
#
# It binds to 127.0.0.1 only. Stop it with Ctrl-C.
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .env ] || { echo "No .env found. Run: cp env.example .env" >&2; exit 1; }
[ -f litellm_config.yaml ] || {
  echo "No litellm_config.yaml. Run: uv run --env-file .env python scripts/make_config.py" >&2
  exit 1
}

set -a
# shellcheck disable=SC1091
. ./.env
set +a

: "${NEBIUS_API_KEY:?NEBIUS_API_KEY is empty in .env}"
: "${LITELLM_MASTER_KEY:?LITELLM_MASTER_KEY is empty in .env}"

# With an activated virtualenv (the pip route) use its litellm; otherwise uv.
if [ -n "${VIRTUAL_ENV:-}" ]; then
  runner=(litellm)
else
  runner=(uv run litellm)
fi

exec "${runner[@]}" \
  --config litellm_config.yaml \
  --host 127.0.0.1 \
  --port "${LITELLM_PORT:-4000}"
