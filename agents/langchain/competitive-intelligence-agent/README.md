# Competitive Intelligence Agent

A LangChain **Deep Agent** that produces decision-grade competitive briefs, powered by an LLM served by [Nebius Token Factory](https://tokenfactory.nebius.com/), and real-time web research via [Tavily](https://tavily.com/).

You give it a single company name. It picks the top competitors itself, researches each across **pricing**, **recent activity**, and **sentiment**, and synthesizes a strategic brief.

## Why deep agents

A regular tool-calling agent gets shallow on a task like this — it does one search, hallucinates the rest. Deep Agents add three primitives that make multi-step research actually work:

- **Planning** — a `write_todos` tool the agent uses to lay out work before it starts, and tick off as it goes.
- **A virtual filesystem** — `write_file` / `read_file` so the agent can accumulate findings and produce a single clean final artifact.
- **Sub-agents** — bounded specialist agents the lead can delegate to. We ship three:
  - `pricing-researcher` — finds and extracts the official pricing page.
  - `news-researcher` — surfaces launches, funding, and exec moves from the
    last 30–90 days (uses Tavily's `topic="news"` + `time_range`).
  - `sentiment-researcher` — gauges developer/customer sentiment from HN,
    Reddit, G2, and Capterra (uses Tavily's `include_domains`).

All sub-agents share two tools: `tavily_search` (LLM-optimized web search) and `tavily_extract` (clean-markdown page fetch). Everything else — planning, files, delegation — is provided by Deep Agents out of the box.

## Setup

This project uses [uv](https://docs.astral.sh/uv/).

```bash
cd agents/langchain/competitive-intelligence-agent
uv sync
cp env.example .env
```

Then edit `.env`:

```bash
# https://tokenfactory.nebius.com/
NEBIUS_API_KEY=your-nebius-api-key

# https://tavily.com/
TAVILY_API_KEY=your-tavily-api-key
```

## Run

### CLI

```bash
uv run cli.py "Netflix"
```

### Streamlit (web UI)

```bash
uv run streamlit run streamlit_app.py
```

Opens a browser with a branded activity feed: enter a company in the sidebar, click **Generate Brief**, and watch the agent plan, dispatch sub-agents, and stream results live. The final brief renders as markdown with a download button.

That's it. The agent will:

1. Identify Netflix's top direct competitors.
2. Lay out a TODO plan covering all dimensions.
3. Dispatch sub-agents in parallel for each company.
4. Synthesize the results into `brief.md` and save it to disk
   (`./brief-netflix.md` by default).

You'll see every step rendered live in the terminal: plan updates, tool calls, sub-agent dispatches, and the final brief.

### Options

```bash
uv run cli.py "Linear" \
  --model "moonshotai/Kimi-K2.5" \
  --output ./linear-brief.md
```

| Flag                 | Default                  | Notes                                         |
| -------------------- | ------------------------ | --------------------------------------------- |
| `--model`, `-m`      | `moonshotai/Kimi-K2.5`   | Any tool-calling capable Nebius TF model.     |
| `--output`, `-o`     | `./brief-<company>.md`   | Where to save the final markdown brief.       |
| `--recursion-limit`  | `150`                    | Bump if the agent runs out of LangGraph steps.|

## What the output looks like

The brief is structured for action, not entertainment:

- **TL;DR** — 3-5 bullets on where the target wins/loses.
- **Side-by-side table** — pricing, free tier, momentum, sentiment per company.
- **Per-company detail** — pricing / recent moves / sentiment paragraphs with inline source URLs.
- **Strategic implications** — opinionated bullets on what the target should do about it.
- **Sources** — every URL the sub-agents cited, grouped by company.

## Files

```
agent.py         # Lead agent + 3 sub-agent specs + the brief-schema prompt
cli.py           # Typer entry point + Rich live renderer + output handling
streamlit_app.py # Streamlit web UI with live activity feed + brief viewer
```

Two files. The Deep Agents SDK does the heavy lifting — we just compose model, two tools, three sub-agent prompts, and a brief structure.

## References

- LangChain Deep Agents — <https://docs.langchain.com/oss/python/deepagents/overview>
- LangChain Tavily — <https://docs.langchain.com/oss/python/integrations/tools/tavily_search>
- LangChain Nebius provider — <https://docs.langchain.com/oss/python/integrations/providers/nebius>
- Nebius Token Factory — <https://tokenfactory.nebius.com/>
- Tavily — <https://docs.tavily.com/>
