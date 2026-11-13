#!/usr/bin/env bash
# Launch Claude Code against the local LiteLLM proxy. Call it from the repo you
# want to work in, with any normal Claude Code arguments:
#
#   <recipe-folder>/scripts/claude-tf.sh
#   <recipe-folder>/scripts/claude-tf.sh -p "explain this repo"
#
# The gateway variables are set for this one process only, so your regular
# `claude` (and its Anthropic login) is untouched.
set -euo pipefail
recipe_dir="$(cd "$(dirname "$0")/.." && pwd)"

[ -f "$recipe_dir/.env" ] || { echo "No .env in $recipe_dir. Run: cp env.example .env" >&2; exit 1; }
[ -f "$recipe_dir/claude_code.env" ] || {
  echo "No claude_code.env. Run: uv run --env-file .env python scripts/make_config.py" >&2
  exit 1
}
set -a
# shellcheck disable=SC1091
. "$recipe_dir/.env"
# shellcheck disable=SC1091
. "$recipe_dir/claude_code.env"
set +a

: "${LITELLM_MASTER_KEY:?LITELLM_MASTER_KEY is empty in .env}"
: "${TF_MAIN_MODEL:?TF_MAIN_MODEL is empty in .env}"
: "${TF_FAST_MODEL:?TF_FAST_MODEL is empty in .env}"

# Where requests go, and the credential for the proxy (not the Nebius key).
export ANTHROPIC_BASE_URL="http://127.0.0.1:${LITELLM_PORT:-4000}"
export ANTHROPIC_AUTH_TOKEN="$LITELLM_MASTER_KEY"

# Every Claude Code model slot must resolve to a name the proxy serves. A slot
# left unset keeps its Claude model ID, which the proxy answers with HTTP 400.
export ANTHROPIC_MODEL="$TF_MAIN_MODEL"
export ANTHROPIC_DEFAULT_OPUS_MODEL="$TF_MAIN_MODEL"
export ANTHROPIC_DEFAULT_SONNET_MODEL="$TF_MAIN_MODEL"
export ANTHROPIC_DEFAULT_FABLE_MODEL="$TF_MAIN_MODEL"
export ANTHROPIC_DEFAULT_HAIKU_MODEL="$TF_FAST_MODEL"
export CLAUDE_CODE_SUBAGENT_MODEL="$TF_MAIN_MODEL"
for slot in OPUS SONNET FABLE; do
  export "ANTHROPIC_DEFAULT_${slot}_MODEL_DESCRIPTION=Token Factory main model"
done
export ANTHROPIC_DEFAULT_HAIKU_MODEL_DESCRIPTION="Token Factory fast model"

# List the proxy's other routes (TF_EXTRA_MODELS) in the /model picker.
export CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1

# Context window. Claude Code cannot look these models up, so tell it the size
# make_config.py worked out, and stop the "Default" row in /model from switching
# to a 1M-token window that the model may not have. Export your own
# CLAUDE_CODE_MAX_CONTEXT_TOKENS before calling this script to override it.
export CLAUDE_CODE_MAX_CONTEXT_TOKENS="${CLAUDE_CODE_MAX_CONTEXT_TOKENS:-$TF_CONTEXT_TOKENS}"
export CLAUDE_CODE_DISABLE_1M_CONTEXT=1

# Claude Code never needs the provider key; keep it out of its environment so
# no command the model runs can read it.
unset NEBIUS_API_KEY LITELLM_MASTER_KEY

# claude_settings.json: ask-before-acting permission mode, WebSearch off, and no
# "Co-Authored-By: Claude" trailer on commits. The README explains each one.
exec "${CLAUDE_BIN:-claude}" --settings "$recipe_dir/claude_settings.json" "$@"
