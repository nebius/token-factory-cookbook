from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool
from tavily import TavilyClient
import os
from dotenv import load_dotenv

load_dotenv()

# Set up the model with the user-provided API key
model = OpenAIModel(
    model_name='meta-llama/Meta-Llama-3.1-70B-Instruct',
    provider=OpenAIProvider(
        base_url='https://api.tokenfactory.nebius.com/v1/',
        api_key=os.environ['NEBIUS_API_KEY']
    )
)

# Search provider selection: "duckduckgo" (default), "tavily", or "both"
search_provider = os.environ.get("SEARCH_PROVIDER", "duckduckgo").lower()


def tavily_search_tool(query: str) -> str:
    """Search the web using Tavily for current information."""
    client = TavilyClient()  # Uses TAVILY_API_KEY env var
    response = client.search(query=query, max_results=5, search_depth="basic")
    results = []
    for r in response["results"]:
        results.append(f"{r['title']}: {r['content']}")
    return "\n\n".join(results)


# Build the tools list based on SEARCH_PROVIDER
tools = []
if search_provider in ("duckduckgo", "both"):
    tools.append(duckduckgo_search_tool())
if search_provider in ("tavily", "both"):
    tools.append(tavily_search_tool)

# Create the agent with a weather-focused prompt
agent = Agent(
    model=model,
    tools=tools,
    system_prompt="You are a weather assistant. Search the web to find the current weather forecast for the requested city."
)

city = "New York"  # Change this to any city you like!

# Run the agent
result = agent.run_sync(f"What is the weather forecast for {city} today?")

# Display the result
print(f"Weather forecast for {city}:")
print(result.output)
