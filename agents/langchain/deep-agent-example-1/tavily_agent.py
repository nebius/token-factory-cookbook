"""Deep agent with real-time web search via Tavily, on a Nebius Token Factory model.

Same deep-agent loop as `research_agent_1.py` (planning, virtual file system,
sub-agents), but with a Tavily search tool so the agent can research live sources
instead of relying on the model's own knowledge.

Requires `NEBIUS_API_KEY` and `TAVILY_API_KEY` in the environment or in a local
`.env` file — see `env.example`.
"""

import json
import os

from deepagents import create_deep_agent
from dotenv import load_dotenv
from langchain_nebius import ChatNebius
from langchain_tavily import TavilySearch

load_dotenv()

RESEARCH_QUESTION = (
    "Research GPUs available in the US in 2026 and write a detailed report."
)


def require_keys() -> None:
    """Fail early with an actionable message rather than deep inside a client."""
    missing = [
        name
        for name in ("NEBIUS_API_KEY", "TAVILY_API_KEY")
        if not os.getenv(name)
    ]
    if missing:
        raise RuntimeError(
            f"Set {' and '.join(missing)} in the environment or this folder's "
            ".env file (copy env.example to .env)."
        )


def main() -> None:
    require_keys()

    tavily_search = TavilySearch(max_results=5, search_depth="advanced")
    model = ChatNebius(model="MiniMaxAI/MiniMax-M3")
    agent = create_deep_agent(model=model, tools=[tavily_search])

    result = agent.invoke({
        "messages": [{"role": "user", "content": RESEARCH_QUESTION}]
    })

    # Full trace first (planning steps, sub-agent calls), then the final report.
    print(json.dumps(result, indent=2, default=str))
    print(result["messages"][-1].content)


if __name__ == "__main__":
    main()
