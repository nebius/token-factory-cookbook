# LangChain `deepagents` + Nemotron @ Nebius Token Factory

A starter example of a [LangChain Deep Agent](https://github.com/langchain-ai/deepagents)
powered by an **Nvidia Nemotron LLM** served by [Nebius Token Factory](https://tokenfactory.nebius.com/).

Deep agents extend a regular tool-calling agent with:

- **Planning** via a `write_todos` tool
- **A virtual file system** (`write_file` / `read_file` / `ls`) for notes
- **Sub-agents** the lead agent can delegate bounded tasks to



## Setup

This project uses [uv](https://docs.astral.sh/uv/) for dependency management.

```bash
cd agents/nemotron-agents
uv sync
```

Create a `.env` file from the template and fill in your API keys:

```bash
cp env.example .env
```

Edit `.env`:

```bash
# get key from https://tokenfactory.nebius.com/
NEBIUS_API_KEY=your-nebius-api-key
```

## Run the Agent

file: [research_agent_1_nemotron.py](research_agent_1_nemotron.py)

Bare deep agent (no external tools):

```bash
uv run python research_agent_1_nemotron.py
```

The report is written to `output.md`, and a short summary is printed to stdout. You can view a sample output [here](output-example.md).

## Run the Agent with Metrics 

file : [research_agent_2_nemotron_metrics.py](research_agent_2_nemotron_metrics.py)

This agent will print out metrics like 
- tool calls
- tokens count ..etc

Run it 

```bash
uv run python research_agent_2_nemotron_metrics.py
```

you will see output similar to 


```text
--- Run Summary ---
Call #   Tool calls   Input tokens   Output tokens
---------------------------------------------------
1        1            3,361          328
2        1            4,124          77
3        1            17,022         101
4        0            18,427         849
---------------------------------------------------

Total input tokens:  42,934
Total output tokens: 1,355
Total tokens:        44,289
```

## References

- LangChain Deep Agents: <https://github.com/langchain-ai/deepagents>
- LangChain Nebius provider: <https://docs.langchain.com/oss/python/integrations/providers/nebius>
- Nebius Token Factory: <https://studio.nebius.com/>
- Tavily: <https://tavily.com/>
