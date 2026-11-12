# Using OpenCode with Token Factory

[OpenCode](https://opencode.ai/) is a coding agent that lives in your terminal, and Nebius Token Factory is one of the providers built into it. There is no gateway to configure and no base URL to paste: run `/connect`, pick **Nebius Token Factory**, paste an API key once, and every Token Factory model you have access to shows up in the model picker.

- [What you need](#what-you-need)
- [Option 1: Native support](#option-1-native-support)
- [Option 2: Add Token Factory as a custom provider](#option-2-add-a-custom-provider)
- [Option 3: Use a proxy](#option-3-using-a-proxy)
- [Pick a model](#pick-a-model)
  - [Kimi K3.1 Pro](#kimi-k31-pro)
- [Give it real work](#give-it-real-work)
- [What one run costs](#what-one-run-costs)
- [Verify the setup](#verify-the-setup)
- [Troubleshooting](#troubleshooting)
- [Keep the cost down](#keep-the-cost-down)
- [Clean up](#clean-up)
- [Guides and resources](#guides--resources)

## What you need

- [OpenCode](https://opencode.ai/docs/) installed and on your `PATH`
- A [Nebius Token Factory](https://tokenfactory.nebius.com/) account — see [Getting Started](../start-here/setup.md)
- About five minutes for setup, and roughly $0.76 if you run the [example prompt](#give-it-real-work) on GLM-5.2

### Create a Token Factory API key

In [Token Factory](https://tokenfactory.nebius.com/), select the project you want to bill against, open **API keys**, and select **Get API key**. Copy the key — you will paste it into OpenCode in the next step, and Token Factory will not show it again.

![The API keys page in Nebius Token Factory](assets/opencode/00-api-keys.png)

Treat the key like a password. It authorizes paid inference against that project.

## Option 1: Native support

Easiest. Start an interactive session from the directory you want to work in:

```bash
opencode
```

1. Run `/connect`.

   ![The /connect command in OpenCode](assets/opencode/01-connect-command.png)

2. Type `nebu` to filter the provider list, then select **Nebius Token Factory**.

   ![Selecting Nebius Token Factory in the OpenCode provider list](assets/opencode/02-nebius-provider.png)

3. Paste the API key and press enter.

   ![Entering the Nebius Token Factory API key in OpenCode](assets/opencode/03-api-key.png)

4. Use `/models` to select a model.

   ![Choosing a Nebius Token Factory model in OpenCode](assets/opencode/04-kimi-k3-model.png)

5. That's it!

OpenCode stores the credential locally — on macOS and Linux in `~/.local/share/opencode/auth.json` — so this is a one-time step per machine, not per project.

[🎥 howto video](https://www.youtube.com/watch?v=216_T--JE0k) &nbsp;•&nbsp; [full flow recording](https://github.com/amrrs/opencode-nebiustf-cookbook/blob/main/media/opencode-kimi-k3.mp4)

## Option 2: Add a custom provider

This is a handy option for newer models that don't appear in the catalog.

1. Define a custom provider in `opencode.jsonc`.  
   The file is usually at `~/.config/opencode/opencode.jsonc`
2. Use this example snippet. You can also find examples here: [example 1](opencode.jsonc.example1) and [example 2](opencode.jsonc.example2)
   ```json
   {
        "$schema": "https://opencode.ai/config.json",
        "provider": {
            "nebius-token-factory-custom": {
                "npm": "@ai-sdk/openai-compatible",
                "name": "Nebius Token Factory (Custom)",
                "options": {
                    "baseURL": "https://api.tokenfactory.nebius.com/v1"
                },
                "models": {
                    "zai-org/GLM-5.3-Flash": {
                        "name": "GLM-5.3-Flash",
                        "tool_call": true,
                        "reasoning": true,
                        "limit": {
                            "context": 1048576,
                            "output": 1048576
                        },
                        "cost": {
                            "input": 0.15,
                            "output": 0.5
                        }
                    }
                }
            }
        }
   }
   ```
3. Restart `opencode`
4. Use `/connect` to the custom provider we just defined, e.g. `Nebius Token Factory (Custom)`
5. Enter API key
6. Use `/models` to select the models defined for this provider!


## Option 3: Using a proxy

Use this proxy: [Nebius TF Relay](https://nebius-tf-relay.vercel.app/)

## Pick a model

### Kimi K3.1 Pro

Use the exact Token Factory API model ID `moonshotai/Kimi-K3.1-Pro`. Select Kimi K3.1 Pro under **Nebius Token Factory** in `/models` when it is available in your provider catalog.

If the built-in catalog has not added the model yet, use [Option 2](#option-2-add-a-custom-provider) with the same API model ID and the current capabilities shown on the [model details page](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=moonshotai/Kimi-K3.1-Pro). Do not copy the GLM context, output limits or prices into a Kimi entry.

For a direct API call, use the [K3.1 Pro quickstart and notebook](../models/kimi-k3.1-pro.md). The screenshots, dated table and GLM-5.2 cost example below document older runs, not K3.1 Pro measurements.

### Earlier model examples

OpenCode model identifiers are `nebius/<vendor>/<model>` — the Token Factory model ID with the provider prefix in front:

| Model | OpenCode identifier | Context | Input / output per 1M tokens |
| --- | --- | ---: | ---: |
| Kimi K3 | `nebius/moonshotai/Kimi-K3` | 1M | $3.00 / $15.00 |
| GLM-5.2 | `nebius/zai-org/GLM-5.2` | 1M | $1.40 / $4.40 |
| MiniMax-M3 | `nebius/MiniMaxAI/MiniMax-M3` | 1M | $0.30 / $1.20 |
| Llama 3.3 70B Instruct | `nebius/meta-llama/Llama-3.3-70B-Instruct` | 128K | $0.13 / $0.40 |

Model IDs, context limits, and prices above were checked on August 28, 2026. They change, so confirm yours in the [Token Factory model catalog](https://tokenfactory.nebius.com/models/catalog) and on the [pricing page](https://tokenfactory.nebius.com/pricing).

Two things worth knowing before you spend anything:

- **The model list is per account.** OpenCode shows what the provider publishes; whether a specific model answers depends on your account's access.
- **Pick for the job, not for the headline.** An agent loop resends its accumulated context on every step, so input tokens dominate the bill. A mid-priced model that finishes in ten steps is often cheaper than a premium one that finishes in eight.

If a brand-new model has not made it into the built-in catalog yet, you can still reach it with [Option 2](#option-2-add-a-custom-provider).

## Give it real work

Setup means nothing until the model builds something. Paste the prompt below into the session and let the agent work.

![Entering a prompt in OpenCode with a Nebius Token Factory model selected](assets/opencode/05-kimi-k3-prompt.png)

The prompt asks for a single-page, dependency-free token cost calculator: one self-contained `index.html`, live results, real `<label>` elements, an `aria-live` results region, validation that never renders `NaN`, and a `README.md` documenting the formula. It is deliberately small and fully checkable by eye — the point is to watch a Token Factory model drive an agent loop end to end, not to build something large.

<details>
<summary>The full prompt (also in <a href="assets/opencode/prompt.md">assets/opencode/prompt.md</a>)</summary>

```text
Build a single-page token cost calculator for Nebius Token Factory models as one
self-contained `index.html` file. No build step, no frameworks, no bundler, and no
network requests at runtime — opening the file with `file://` must be enough.

Requirements:

- Inputs for model ID, input price per 1M tokens, output price per 1M tokens, input
  tokens per run, output tokens per run, and number of runs.
- Live results that recompute on every input change: input cost per run, output cost
  per run, total cost per run, and projected cost for all runs, each shown in USD with
  four decimal places.
- Seed the form with `moonshotai/Kimi-K3` at $3.00 input and $15.00 output per 1M tokens.
- A preset list of at least three Token Factory models that fills the form when a preset
  is chosen, with the pricing date stated in the page as an "as of" note.
- Validation that rejects negative and non-numeric values with an inline message next to
  the offending field, never rendering `NaN`.
- Plain CSS only, readable at both 375px and 1280px widths, and accessible: every input
  has a real `<label>`, and results update through an `aria-live` region.
- Keep the page under 400 lines and add a top-of-file comment block explaining the cost
  formula.

Also write a `README.md` that states how to open the page, the exact cost formula used,
that prices are user-supplied rather than fetched, and where to check current Token
Factory pricing.
```

</details>

You can also run it non-interactively, which is how the cost below was measured:

```bash
opencode run --model nebius/zai-org/GLM-5.2 --auto "$(cat prompt.md)"
```

`--auto` approves file writes without prompting. Use it in a scratch directory, not in a repository you care about.

## What one run costs

One non-interactive run of that prompt on GLM-5.2, measured on August 28, 2026 with opencode 1.18.21:

| Metric | Value |
| --- | --- |
| Assistant turns | 21 |
| Input tokens | 483,125 |
| Output tokens | 9,830 (plus 9,576 reasoning tokens) |
| Wall time | 128s |
| Cost reported by OpenCode | $0.7618 |

The shape of that bill is the lesson. Output is tiny — a 200-line HTML file and a README — while input is nearly half a million tokens, because each of the 21 steps resent the whole conversation plus tool output. Reasoning tokens are reported as a detail inside output usage and are billed at the output rate, so count them once.

Your number will differ. Agent runs are not deterministic, and anything that adds to the system prompt on your machine — installed skills, plugins, `AGENTS.md` files, MCP servers — is resent on every step and shows up as input tokens.

The generated app and the full run notes are in the [companion repository](https://github.com/amrrs/opencode-nebiustf-cookbook).

## Verify the setup

- `/models` lists models under **Nebius Token Factory**.
- A prompt gets a reply, and the footer shows the Token Factory model you selected.
- Token Factory's usage view for that project shows requests appearing as you work.

To confirm which models your key can actually reach, ask the API directly:

```bash
curl -s https://api.tokenfactory.nebius.com/v1/models \
  -H "Authorization: Bearer $NEBIUS_API_KEY" | python3 -m json.tool
```

## Troubleshooting

**Nebius Token Factory is missing from `/connect`.** Update OpenCode and restart it. The provider list ships with the release.

**A model is missing from `/models`.** Compare the picker against the `curl` output above. If the API lists it and OpenCode does not, update OpenCode; if neither lists it, your account does not have access. A model that is too new for the built-in catalog can be added with [Option 2](#option-2-add-a-custom-provider).

**A run hangs with no output at all.** OpenCode waits on the first token, so a model that never sends one looks like a frozen agent. Test it outside OpenCode:

```bash
curl -s -m 60 https://api.tokenfactory.nebius.com/v1/chat/completions \
  -H "Authorization: Bearer $NEBIUS_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"zai-org/GLM-5.2","messages":[{"role":"user","content":"Reply with exactly: PONG"}],"max_tokens":30}'
```

A healthy Token Factory model answers this in about a second. If that call also returns nothing before the timeout, the problem is upstream of OpenCode — switch models with `/models` and carry on in the same session. That is exactly why the measured run above used GLM-5.2: on the day it was written, one model on the account returned no first token for over 90 seconds while others answered immediately.

**401 or 403 on every request.** The key is revoked, mistyped, or belongs to a different project. Run `/connect` again and paste a fresh key.

## Keep the cost down

- Start a new session for unrelated work. Context carried from a finished task is resent as input tokens on every step.
- Switch models mid-session with `/models` — plan on a stronger model, execute on a cheaper one.
- Prune what loads into every prompt: unused skills, plugins, and MCP servers are pure input-token overhead.
- Give the agent a narrow, checkable task. Fewer steps is the single biggest lever on cost.

## Clean up

The demo prompt only writes files in the working directory, so deleting that directory removes everything it produced. To disconnect the provider, remove the `nebius` entry from `~/.local/share/opencode/auth.json`, and delete the API key in Token Factory if you no longer need it.

## Guides & Resources

- A [setup guide](https://github.com/m1burn/omo-nebius-token-factory) for agentmemory + OpenCode + Token Factory
- [OpenCode documentation](https://opencode.ai/docs/) &nbsp;•&nbsp; [OpenCode providers](https://opencode.ai/docs/providers)
- [Token Factory model catalog](https://tokenfactory.nebius.com/models/catalog) &nbsp;•&nbsp; [Token Factory documentation](https://docs.tokenfactory.nebius.com/)
