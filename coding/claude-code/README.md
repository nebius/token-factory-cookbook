[Cookbook](../../README.md) / [Coding agents](../README.md) / Claude Code

# Claude Code with Nebius Token Factory

Run [Claude Code](https://code.claude.com/docs) on open models hosted on
[Nebius Token Factory](https://tokenfactory.nebius.com), through a
[LiteLLM](https://docs.litellm.ai/) proxy on your own machine.

> **Unofficial setup.** Anthropic's gateway documentation says it "doesn't
> support routing Claude Code to non-Claude models through any gateway".
> Everything here was run end to end on 2026-11-12 with Claude Code 2.1.321 and
> LiteLLM 1.109.1. [RESULTS.md](RESULTS.md) records what worked and what did
> not, model by model. Expect it to drift as Claude Code changes.

## What you will build

Claude Code speaks the Anthropic Messages API (`POST /v1/messages`). Token
Factory speaks the OpenAI Chat Completions API. A local proxy translates between
the two:

```
Claude Code ──/v1/messages──▶ LiteLLM on 127.0.0.1 ──/v1/chat/completions──▶ Token Factory
```

You get a launcher script that starts Claude Code against that proxy with the
settings testing showed it needs, and leaves your normal `claude` command and
its Anthropic login untouched. No Anthropic account is needed for the proxied
session.

Nothing in this recipe names a model. Token Factory retires models regularly
and does not reroute retired IDs, so the scripts read the live catalog and you
choose from what is being served today.

## Requirements

- Claude Code installed (`claude --version`). Tested with 2.1.321.
- [`uv`](https://docs.astral.sh/uv/), or Python 3.12 and pip (see
  [Without uv](#without-uv)).
- A Token Factory account and API key. See [Getting started](../../start-here/setup.md).

Every prompt is a paid Token Factory request, and Claude Code sends about
12,000 tokens of instructions and tool definitions with each one. The
three-turn test task in [RESULTS.md](RESULTS.md) cost between $0.01 and $0.13
depending on the model. The recipe creates nothing outside this folder and
changes no external system.

## Setup

Run everything from this folder.

**1. Install the proxy** into a project-local virtual environment:

```bash
uv sync
```

**2. Create your `.env`:**

```bash
cp env.example .env
```

Fill in `NEBIUS_API_KEY`, and set `LITELLM_MASTER_KEY` to any long random string
(`openssl rand -hex 24` makes one). The master key is only the password between
Claude Code and your local proxy.

**3. Pick models from the live catalog:**

```bash
uv run --env-file .env python scripts/list_models.py
```

This prints every live text model that advertises tool calling, with context
window and price. Put one ID in `TF_MAIN_MODEL` (answers your prompts) and one
in `TF_FAST_MODEL` (session titles, web-page summaries and other background
work; a cheap model is fine). `TF_EXTRA_MODELS` takes more IDs, comma
separated, that you can switch to with `/model`.

Check your choice against the
[deprecation notices](https://docs.tokenfactory.nebius.com/llms.txt). A model
can still be listed for a while after its notice date.

**4. Generate the proxy configuration:**

```bash
uv run --env-file .env python scripts/make_config.py
```

It checks your IDs against the live catalog and writes `litellm_config.yaml`
(one route per model, with today's context window and prices) and
`claude_code.env` (the context window Claude Code should assume). Run it again
whenever you change models. No key is written to either file.

**5. Start the proxy** and leave it running:

```bash
./scripts/start_proxy.sh
```

It listens on `127.0.0.1` only, port `4000` unless you set `LITELLM_PORT`.

## Run

In a second terminal, from the repository you want to work in:

```bash
/path/to/coding/claude-code/scripts/claude-tf.sh
```

Any Claude Code argument passes through, for example
`claude-tf.sh -p "explain this repo"`. Claude Code opens in manual permission
mode with your main model, and asks before each edit and command.

### What the launcher sets, and why

`scripts/claude-tf.sh` is short; read it. These are the settings that mattered
in testing:

| Setting | Why |
|---|---|
| `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` | Point Claude Code at the proxy and authenticate with `LITELLM_MASTER_KEY`. |
| `ANTHROPIC_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,FABLE,HAIKU}_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL` | Every model slot must name a proxy route. A slot left alone keeps its Claude ID and the proxy answers `400`. |
| `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1` | `/model` lists every route the proxy serves. |
| `CLAUDE_CODE_MAX_CONTEXT_TOKENS` | Claude Code assumes 200,000 tokens for an unknown model. Some Token Factory models are smaller and reject a longer prompt with `400`. |
| `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` | Without it, the "Default" row in `/model` silently switches the session to a 1M-token window. |
| `--settings claude_settings.json` | Three safety defaults, below. |
| `unset NEBIUS_API_KEY` | Claude Code never needs the provider key, so it is removed from the environment its shell commands inherit. |

`claude_settings.json` holds three defaults you may want to change:

- **`permissions.defaultMode: "default"`**: Claude Code asks before each edit
  and command. Its usual interactive default is auto mode, whose safety
  classifier is a second model call. Through this proxy that call goes to your
  Token Factory model, which was never evaluated for that job. Pass
  `--permission-mode acceptEdits` (or another mode) to override per session.
- **`permissions.deny: ["WebSearch"]`**: Claude Code's web search runs on
  Anthropic's servers. Through the proxy no search happens, and in testing the
  model wrote plausible "search results" from memory with no error. `WebFetch`
  does work, so the model can still read a URL you give it.
- **`attribution`** set to empty: otherwise commits made in the session carry a
  `Co-Authored-By: Claude Code` trailer for work a different model did.

### Things to know

**`max_tokens`.** Token Factory defaults `max_tokens` to 8192 when a request
omits it. Claude Code does not omit it: for a model ID it does not recognise it
sends `max_tokens: 32000` on every request, and the proxy forwards that
unchanged. All four tested models accepted 32000, and on the model with a
131,072-token window a 109,000-token prompt plus 32000 was still accepted. To
change it, export `CLAUDE_CODE_MAX_OUTPUT_TOKENS` before launching; the value
reaches Token Factory as `max_tokens`.

**Cost display is wrong; token counts are right.** `/cost` prices unknown models
at a built-in fallback rate and says so ("costs may be inaccurate due to usage of
unknown models"). In testing it overstated real spend by 2.5x to 29x depending
on the model. The input, output and cache-read token counts it shows matched
Token Factory's usage exactly, so multiply those by the prices from
`scripts/list_models.py`, or read your spend in the Token Factory console.

**Context window.** `make_config.py` sets the window to your smallest routed
model, capped at 200,000. If all your models have a larger window and you want
to use it, export `CLAUDE_CODE_MAX_CONTEXT_TOKENS=<tokens>` before launching.
Bigger windows cost more per request.

**Reasoning.** Models that reason stream their reasoning and Claude Code shows it
as thinking. You cannot steer it: `/effort` and the thinking settings are dropped
by the proxy, so each model reasons at its own default.

**Prompt caching** is automatic on Token Factory. Claude Code's cache markers are
dropped, cache hits still happen, and they show up as cache-read tokens.

**Region.** The configuration uses the global Token Factory host and does not
pin a region.

## Validate

Offline, with no key and no network:

```bash
python3 -m unittest discover -s tests -v
```

The tests cover model filtering, the generated proxy routes and context window,
the stream checks, and the shipped settings and environment template.

Against the live API, with the proxy running:

```bash
uv run --env-file .env python scripts/smoke_test.py
```

For each model it sends a plain message, a streamed message, a streamed tool
call and a token count through the proxy, and prints `PASS` or `FAIL`. Each run
costs a fraction of a cent. Claude Code is tool calls all the way down, so do
not use a model that fails the streamed tool call.

What was verified on 2026-11-12, and what was not, is in [RESULTS.md](RESULTS.md).

## Troubleshooting

- **`400` naming a `claude-...` model.** Something asked for a model slot the
  launcher did not map. Run `claude-tf.sh`, not `claude`.
- **`400 No connected db.` from the proxy.** The key Claude Code sent is not the
  proxy's `LITELLM_MASTER_KEY` (the proxy went looking for it in a key database
  this setup does not have). Usually `.env` changed after the proxy started;
  restart `start_proxy.sh`.
- **`... is not in the live catalog`.** The model was retired. Pick another with
  `scripts/list_models.py` and run `make_config.py` again.
- **`Input length (...) exceeds model's maximum context length`.** The session
  outgrew the model. Run `/compact`, or start a new session.
- **A reply takes a long time to start.** Check the model, not the proxy: in
  testing one model occasionally took 25 to 50 seconds to send its first token
  while the others answered in about a second.
- **Port in use.** Set `LITELLM_PORT` in `.env` and restart the proxy.

## Without uv

```bash
python3.12 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp env.example .env        # then fill it in
set -a; . ./.env; set +a
python scripts/list_models.py
python scripts/make_config.py
./scripts/start_proxy.sh
```

`requirements.txt` is a frozen `uv export` of `uv.lock`. Run
`python scripts/smoke_test.py` in a second terminal after the same `activate`
and `set -a; . ./.env; set +a` lines, then launch with `scripts/claude-tf.sh`
as above.

## Limitations and cleanup

- This is a single-user, local setup. The proxy binds to `127.0.0.1`, has no
  database, and the master key is its only credential. Do not expose it.
- Web search is off, reasoning effort cannot be changed, and the cost display
  is wrong, as described above.
- Not tested: images and other non-text input, MCP servers, hooks, IDE
  extensions, sessions long enough to trigger automatic compaction, Linux and
  Windows.
- Model behaviour varies. All four tested models finished the test task, but
  one needed several retries. Review what the model does before you approve it.

To clean up, stop the proxy with Ctrl-C and remove the local files:

```bash
rm -rf .venv .env litellm_config.yaml claude_code.env
```

Revoke the API key in the Token Factory console if you created one only for
this recipe.

## Files

| File | Purpose |
|---|---|
| `env.example` | Template for `.env`. Values are empty on purpose. |
| `scripts/list_models.py` | Lists live, tool-capable Token Factory models. |
| `scripts/make_config.py` | Writes `litellm_config.yaml` and `claude_code.env` from the live catalog. |
| `scripts/start_proxy.sh` | Starts LiteLLM on `127.0.0.1`. |
| `scripts/smoke_test.py` | Checks each route the way Claude Code will use it. |
| `scripts/claude-tf.sh` | Launches Claude Code against the proxy. |
| `claude_settings.json` | Permission mode, WebSearch and attribution defaults. |
| `tests/` | Offline unit tests. |
| `RESULTS.md` | What was tested, per model, with the evidence. |

## Source and license

Written for this cookbook and covered by the repository [license](../../LICENSE).
Claude Code and LiteLLM are installed from their own distributions under their
own licenses; no third-party code is copied here. Claude Code's gateway
behaviour is documented at
[code.claude.com/docs/en/llm-gateway-protocol](https://code.claude.com/docs/en/llm-gateway-protocol).
