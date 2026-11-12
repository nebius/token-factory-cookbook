#!/usr/bin/env bash
# Developer helper: run a command with credentials read from where they already live on this
# machine (the Civo CLI config and an existing env file), without copying them into the repo.
#   scripts/with-local-secrets.sh uv run kubetrace run selector-mismatch
set -euo pipefail
if [[ -z "${CIVO_API_KEY:-}" && -f "$HOME/.civo.json" ]]; then
  CIVO_API_KEY="$(python3 -c 'import json,os;d=json.load(open(os.path.expanduser("~/.civo.json")));print(d["apikeys"][d["meta"]["current_apikey"]])')"
  export CIVO_API_KEY
fi
if [[ -z "${NEBIUS_API_KEY:-}" && -n "${NEBIUS_ENV_FILE:-}" && -f "$NEBIUS_ENV_FILE" ]]; then
  NEBIUS_API_KEY="$(grep '^NEBIUS_API_KEY=' "$NEBIUS_ENV_FILE" | cut -d= -f2-)"
  export NEBIUS_API_KEY
fi
exec "$@"
