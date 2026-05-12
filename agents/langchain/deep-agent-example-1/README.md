# LangChain `deepagents` + Nebius Token Factory

Two starter examples of a [LangChain Deep Agent](https://github.com/langchain-ai/deepagents)
powered by an LLM served by [Nebius Token Factory](https://tokenfactory.nebius.com/).

Deep agents extend a regular tool-calling agent with:

- **Planning** via a `write_todos` tool
- **A virtual file system** (`write_file` / `read_file` / `ls`) for notes
- **Sub-agents** the lead agent can delegate bounded tasks to

## The two agents

| File | Description | Tools |
| ---- | ----------- | ----- |
| `research_agent_1.py` | Bare deep agent — planning, virtual FS, and a default `general-purpose` sub-agent. No external tools. | none |
| `tavily_agent.py` | Same deep-agent loop, but with real web search via Tavily. | `tavily_search`, `think_tool` |

Both use the `moonshotai/Kimi-K2.5` model on Nebius; swap it for any tool-calling capable Nebius model in the source.

## Setup

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
cd agents/langchain/deep-agent-example-1
uv sync
```

Create a `.env` file from the template and fill in your API keys:

```bash
cp env.example .env
```

Edit `.env`:

```bash
# https://tokenfactory.nebius.com/
NEBIUS_API_KEY=your-nebius-api-key

# https://tavily.com/  (only needed for tavily_agent.py)
TAVILY_API_KEY=your-tavily-api-key   
```

## Run

Bare deep agent (no external tools):

```bash
uv run python research_agent_1.py
```

Deep agent with Tavily web search:

(Make sure you have `TAVILY_API_KEY` defined in `.env`)

```bash
uv run python tavily_agent.py
```

Each script prints the full message trace (including planning steps,
sub-agent calls, and the final report) as JSON.

## Files

- `research_agent_1.py` — minimal deep agent on a Nebius LLM
- `tavily_agent.py` — deep agent with Tavily web search + a `think_tool`
- `pyproject.toml` / `uv.lock` — dependencies (managed by uv)
- `env.example` — environment template

## References

- LangChain Deep Agents: <https://github.com/langchain-ai/deepagents>
- LangChain Nebius provider: <https://docs.langchain.com/oss/python/integrations/providers/nebius>
- Nebius Token Factory: <https://studio.nebius.com/>
- Tavily: <https://tavily.com/>
