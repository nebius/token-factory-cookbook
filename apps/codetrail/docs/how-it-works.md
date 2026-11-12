# How Codetrail uses its model

[← Back to the README](../README.md)

Codetrail runs on one open model at a time, set with `NEBIUS_MODEL`: **DeepSeek V4.1 Flash 1017** (`deepseek-ai/DeepSeek-V4.1-Flash-1017`, the default) or **Kimi K3.1 Pro** (`moonshotai/Kimi-K3.1-Pro`). Both take 1,048,576 tokens and images on Nebius Token Factory. Every call records its model, so receipts, exports and the data page name the model that made each one, even after a switch.

Every model call sends the **same prefix**: a system prompt, a repo header (GitHub facts, languages, a summary of the import graph, up to six diagram images), then **every file with numbered lines**. Only the last message changes.

1. **First read: one call, map + main tour.** The model writes a summary, groups files into 4–14 modules and 3–6 architecture layers, draws how they connect, proposes the questions worth asking, and writes the first tour (4–12 steps, each with a file, a line range, an exact quoted anchor line and a short narration). It streams, so the map builds live on screen.
2. **Every extra tour or question.** Same prefix plus the question (and, for a follow-up, a recap of the conversation: the last 6 turns as question plus a short gist, capped at ~10K tokens). Tours come back as strict JSON; answers come back as OpenUI Lang using Codetrail's own block library. Because the prefix is identical, the repo can be billed as **cached input** ($0.006 per 1M tokens instead of $0.30 on DeepSeek V4.1 Flash 1017, $0.20 instead of $2.00 on Kimi K3.1 Pro).
3. **Pull requests.** Same prefix, then the PR: its description, the changed-files list, the patches (most useful files first, up to ~120K tokens) and the PR's version of each changed file with line numbers (up to 40 files). Steps and review notes are checked against the code as the PR leaves it. Stored per head commit, so a new push gets a new tour and old ones stay.
4. **Images.** Architecture diagrams in a repo's README or docs go in as image input.

**Code, not the model, does:** download and filtering, secret scanning, the import graph and entry points, line numbers, token estimates, checking every step and code reference against the real file, marking import-backed links, pricing, storage and rendering.

**Settings:** strict JSON-schema output (JSON mode as a fallback), `reasoning_effort: medium` (Kimi K3.1 Pro always reasons; Token Factory accepts the same setting), and one repair turn only when an answer is invalid or loses more than 30% of its steps. A repair resends the whole repo, so it's rare by design.

## What it costs (measured)

### DeepSeek V4.1 Flash 1017 (October 2026)

Nebius Token Factory prices for `deepseek-ai/DeepSeek-V4.1-Flash-1017`: $0.30 / 1M input, **$0.006 / 1M cached input**, $1.20 / 1M output.

| Repo | Tokens read | Measured |
|---|---|---|
| lukeed/polka | 68K | Map + main tour in one call: **$0.028**, 16 s. A generative-UI answer: $0.022, 5.9 s |
| pmndrs/zustand | 251K | Extra tour with the repo cached: **$0.005**, 99% of input from cache |
| sindresorhus/ky | 437K | Whole-repo read: $0.134, 16 s |
| lukeed/polka, PR #210 | 71K | Pull-request tour with the repo cached: **$0.007**, 95% from cache (PR #198, cache missed: $0.023) |
| lukeed/polka, Research | 68K | A plan, 3 rounds (the third found nothing new) and the answer: **$0.049** for 5 calls, 49 s; 4 of 5 calls from cache |
| lukeed/kleur, `test/` only | 7K | A read of one folder (5 of 18 files), map and tour: **$0.006**, 8 s |

### Kimi K3.1 Pro (November 2026)

Nebius Token Factory prices for `moonshotai/Kimi-K3.1-Pro`: $2.00 / 1M input, **$0.20 / 1M cached input**, $10.00 / 1M output. That's about 7× DeepSeek V4.1 Flash 1017 for fresh input and 33× for cached input; Kimi K3.1 Pro is a much larger model (2.8T parameters, 104B active).

| Repo | Tokens read | Measured |
|---|---|---|
| koajs/koa | 110K | Map + main tour in one call (8 modules in 6 layers, a 9-step tour): **$0.083**, 159 s, with 99.8% of input from the cache. At full price the same 109,692 input and 6,042 output tokens cost **$0.28**; on DeepSeek V4.1 Flash 1017 they'd cost $0.040 |
| koajs/koa | 110K | A generative-UI answer, 3 of 3 references checked: **$0.236**, 39 s, cache missed. With the repo cached it would be about $0.04 |

Costs vary with repo size and with how often the cache hits. Kimi K3.1 Pro took longer than DeepSeek V4.1 Flash 1017 does on repos of this size (DeepSeek read 68K-token polka in 16 s and 437K-token ky in 16 s).

The prompt cache is best-effort ([Token Factory's caching docs](https://docs.tokenfactory.nebius.com/cached-tokens)): a call can land on a server that doesn't hold the repo yet, and an unused prefix can be dropped after a few minutes. In our DeepSeek runs, 6 of 13 follow-up calls were served from it; Kimi's koa question missed it. Every call shows its real cached share, the Ask box shows both prices before you ask, and stored tours, answers and conversations replay free.

## Tech stack

| Layer | Choice |
|---|---|
| Model | DeepSeek V4.1 Flash 1017 (default) or Kimi K3.1 Pro on Nebius Token Factory (OpenAI-compatible API, `openai` SDK, streaming) |
| Agent framework / RAG | None. One call per job on the cached repo (strict JSON or OpenUI Lang), then checks in code; no embeddings or vector DB |
| Generative UI | [OpenUI](https://github.com/thesysdev/openui) (MIT) for Ask answers, from Codetrail's own component library |
| App | Next.js 16, React 19, Tailwind CSS 4, zod 4 |
| Diagrams and graphs | [ELK](https://github.com/kieler/elkjs) layered layout for the architecture, docs and call diagrams (in the browser, and on the server for README images); d3-force, d3-zoom, d3-drag, d3-hierarchy |
| Call graph | The TypeScript compiler's parser for JS/TS; line-based parsing for Python and Go |
| Code | shiki |
| Repo ingest | GitHub REST + one codeload tarball (or a local folder), an import-graph parser (JS/TS incl. tsconfig paths and workspaces, Python, Go, Rust, Java/Kotlin, C/C++, Ruby), [Secretlint](https://github.com/secretlint/secretlint) for secrets, signatures-only compression for files over budget |
| Storage | SQLite via libsql + drizzle: every file of every commit read (FTS5 full-text search), maps, tours, answers, docs, the cost ledger, stats, quotas and accounts. A local file, or Turso when hosted |
| Auth | Better Auth with GitHub (hosted mode only) |
| Share images | `next/og` |
| Agents | `@modelcontextprotocol/sdk` (stdio + Streamable HTTP) |
| Running it | Docker (Next.js standalone), or Node 22 + pnpm |

**Credits.** Ideas we learned from: the URL swap and MCP endpoints of GitDiagram and DeepWiki; fixing line numbers from a quoted snippet, as in deepwiki-open; the step model of CodeTour; the file-level graph of CodeViz; secret scanning and compression from Repomix.
