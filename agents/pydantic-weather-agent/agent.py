from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.common_tools.duckduckgo import duckduckgo_search_tool
import os
from dotenv import load_dotenv

load_dotenv()

# Token Factory retires models, so the ID comes from NEBIUS_MODEL when set.
# Pick a current one from https://tokenfactory.nebius.com/models
model = OpenAIModel(
    model_name=os.environ.get('NEBIUS_MODEL', 'Qwen/Qwen3-30B-A3B-Instruct-2507'),
    provider=OpenAIProvider(
        base_url='https://api.tokenfactory.nebius.com/v1/',
        api_key=os.environ['NEBIUS_API_KEY']
    )
)

# Create the agent with a weather-focused prompt
agent = Agent(
    model=model,
    tools=[duckduckgo_search_tool()],
    system_prompt="You are a weather assistant. Use DuckDuckGo to find the current weather forecast for the requested city."
)

city = "New York"  # Change this to any city you like!

# Run the agent
result = agent.run_sync(f"What is the weather forecast for {city} today?")

# Display the result
print(f"Weather forecast for {city}:")
print(result.output)
