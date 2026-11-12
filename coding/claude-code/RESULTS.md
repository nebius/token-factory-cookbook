[Cookbook](../../README.md) / [Coding agents](../README.md) / [Claude Code](README.md) / Test results

# Test results

Tested on 2026-11-12 on macOS (arm64) with Claude Code 2.1.321, LiteLLM 1.109.1
and the live Token Factory API. Model IDs below are the ones that were live that
day; they are a record of what was tested, not a recommendation to hardcode.

## How it was tested

Each model drove a real Claude Code session in a throwaway git repository
holding a small Python module with two planted bugs and a unit-test file. The
session had three turns, resumed with `--resume`/`--continue`:

1. Read both files, run the tests, explain the failures. No edits.
2. Fix the bugs, re-run the tests.
3. Add a new function and a test for it, run the tests, commit.

A session passed if, afterwards, `python3 -m unittest` was green, the new
function existed and the commit was in `git log`. Sessions ran headless with
`--output-format stream-json --include-partial-messages` so every streamed delta
was captured, and again interactively in a pseudo-terminal for the parts that
only exist in the UI (`/model`, `/cost`, `/context`, permission prompts,
`/compact`).

A recording forwarder sat on both sides of the proxy for the main runs, so the
numbers below come from the wire: 187 `/v1/messages` calls from Claude Code and
189 chat-completion calls to Token Factory, of which 187 returned 200 and 2
returned 400 (both were deliberate context-overflow probes). Those totals
include `moonshotai/Kimi-K3`, which ran the same session and passed; the table
shows its successor, Kimi K3.1 Pro, instead.

Every step in the README was then re-run from an empty folder with three models
on the default port, with Kimi K3.1 Pro as the main model, plus the pip route in
a separate copy.

## Per model

| | `moonshotai/Kimi-K3.1-Pro` | `zai-org/GLM-5.3-Flash` | `Qwen/Qwen3-30B-A3B-Instruct-2507` | `openai/gpt-oss-120b` |
|---|---|---|---|---|
| Three-turn task | Pass | Pass | Pass, with retries | Pass |
| Model calls for the task | 16 | 12 | 21 | 19 |
| Tool calls reaching Claude Code as valid JSON (all recorded calls) | 15 of 15 | 34 of 34 | 45 of 45 | 44 of 45 |
| Read / Edit / Bash / Glob tools | Work | Work | Work | Work |
| Streaming text | Works | Works | Works | Works |
| Streamed tool arguments | One chunk per call | One chunk per call | Token by token | Token by token |
| Reasoning shown as thinking | Yes | Yes | No (model does not reason) | Yes |
| Time to first byte, median / worst (all recorded calls) | 1.3 s / 26.7 s | 1.6 s / 46.4 s | 0.8 s / 1.3 s | 0.8 s / 3.8 s |
| Token counts in `/cost` vs Token Factory usage | Exact | Exact | Exact | Exact |
| Real cost of the task | $0.125 | $0.011 | $0.035 | $0.028 |
| Cost Claude Code displayed | $0.313 (2.5x) | $0.323 (29x) | $0.341 (10x) | $0.239 (9x) |
| Share of input tokens served from cache | 92% | 85% | 94% | 96% |
| Live context window | 1,048,576 | 1,048,576 | 262,144 | 131,072 |
| Window Claude Code assumes by default | 200,000 | 200,000 | 200,000 | 200,000 (too big) |
| `max_tokens: 32000` from Claude Code | Accepted | Accepted | Accepted | Accepted |

Notes per model:

- **Kimi K3.1 Pro** did the task with no wasted steps and passed in both the
  recorded session and the launcher session. In both it created a new branch
  before committing instead of committing on `main`. One of its 16 calls took
  27 seconds to send a first byte; the rest took under 2 seconds.
- **GLM-5.3-Flash** did the work correctly but 5 of its 36 streamed calls took
  more than 5 seconds to send a first byte, the worst 46 seconds. The delay was
  upstream of the proxy. Fine as the background model, noticeable as the main one.
- **Qwen3-30B** needed five edit-and-test loops to get its new test right
  (13 model calls for a turn the others did in 7 to 11). It finishes, but it is
  the one to watch.
- **gpt-oss-120b** has an API-side defect that the proxy hides. In 30 of 45
  streamed tool-call responses, Token Factory sent the closing `}` of the
  arguments under tool-call `index: 1` instead of `0`. LiteLLM re-joined every
  one, so Claude Code saw valid JSON. A client reading the raw stream does not
  get that repair. The single invalid call was the model's own malformed JSON.
  Its 131,072-token window is also below Claude Code's 200,000 default, so the
  launcher's `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is required for it.

## What works for every model

| Area | Result |
|---|---|
| `POST /v1/messages`, streamed and not | Works. Event order was `message_start` ... `message_stop` on every completed call. |
| `POST /v1/messages/count_tokens` | Works: 105 of 105 calls returned 200. It is a local estimate, not the model's tokenizer, so `/context` is approximate. |
| `GET /v1/models` for `/model` | Works with `CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1`; every proxy route is listed as "From gateway". |
| `HEAD /api/hello` startup probe | 404 from the proxy. Harmless. |
| No Anthropic login | A fresh config directory went straight to the prompt after the theme and trust screens. |
| Multi-turn sessions, `--resume`, `--continue` | Work. |
| Permission prompts in manual mode | Work. |
| Subagents (`Agent` tool) | Work, on the model in `CLAUDE_CODE_SUBAGENT_MODEL`. |
| `WebFetch` | Works. The page summary is written by the fast model. |
| `/compact` | Works: 12,446 tokens down to 4,085, and the session still knew what it had done. |
| Prompt caching | Automatic at Token Factory; reported back as cache-read tokens. |
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Reaches Token Factory as `max_tokens` (checked with 4096). |

## What breaks or misleads

| Area | What happens | Handled in this recipe by |
|---|---|---|
| Web search | Claude Code sends Anthropic's server-side `web_search` tool. The proxy cannot run it, Token Factory ignores it, and the model answered "search results" from memory with no error. | `WebSearch` denied in `claude_settings.json`. |
| Auto mode | Interactive Claude Code now starts in auto mode. Its safety classifier ("You are a security monitor for autonomous AI coding agents") ran on a Token Factory model. | Sessions start in manual mode. |
| Cost display | Unknown models are priced at a fallback rate: 2.5x to 29x too high. `/cost` does say "costs may be inaccurate due to usage of unknown models". | Documented. Token counts are exact. |
| Context window | Assumed to be 200,000. A prompt over the real window returns `400 Input length (...) exceeds model's maximum context length (131072)`. | `CLAUDE_CODE_MAX_CONTEXT_TOKENS` from the live catalog. |
| `/model` "Default" row | Without `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` it selects `<model>[1m]` and Claude Code then assumes a 1M window. | Variable set by the launcher. |
| Unmapped model slots | The picker's Fable row, and any slot left at a Claude ID, get `400 Invalid model name`. | All five slots mapped. |
| Reasoning control | `thinking`, `output_config.effort` and `context_management` are dropped by the proxy (`drop_params`). `/effort` changes nothing. | Documented. |
| Commit trailer | Three of four models added a co-author trailer with Anthropic's no-reply address to their commit: two as `Claude Code`, and Kimi K3.1 Pro as `Kimi Code`. | `attribution` emptied. |
| Tool search | A deferred tool's `tool_reference` result reaches the model as an empty string. The tool still becomes callable on the next request, but models remarked on the empty result. | Not handled. Cosmetic in testing. |
| Keep-alive | The proxy sent no `ping` events. With a 46-second first byte nothing timed out, but a longer stall could. | Not handled. |
| Unrecognised-model banner | "Model ... isn't recognized · context assumed to be 200k tokens" at startup. | Gone once the context variable is set. |
| LiteLLM's default host | The released `nebius/` provider still defaults to the older AI Studio host. | `api_base` set to the Token Factory URL in the generated configuration. |

## Not tested

Images and other non-text input, MCP servers, hooks, IDE extensions, sessions
long enough to trigger automatic compaction, recovery after a real mid-session
context overflow, Linux and Windows, and any model beyond the five named above.

If you script Claude Code for unattended runs, set `DISABLE_AUTOUPDATER=1`: a
test instance updated itself in the background during these runs.
