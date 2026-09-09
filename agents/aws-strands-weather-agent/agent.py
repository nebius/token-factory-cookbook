"""Small Strands tool-and-stream smoke test for Nebius Token Factory."""

import asyncio

from strands import Agent, tool
from strands.models.openai import OpenAIModel

from config import load_settings


@tool
def get_temperature(city: str) -> str:
    """Return a fixed demo temperature for a supported city."""
    temperatures = {"paris": "21 C", "tokyo": "26 C"}
    return temperatures.get(city.lower(), "unknown")


async def main() -> None:
    settings = load_settings()
    model = OpenAIModel(**settings.model_kwargs())
    agent = Agent(
        model=model,
        tools=[get_temperature],
        system_prompt="Use get_temperature for temperature questions. State that its value is demo data.",
        callback_handler=None,
    )

    saw_tool = False
    async for event in agent.stream_async(
        "Use the tool to get the demo temperature for Paris, then answer in one sentence."
    ):
        current_tool = event.get("current_tool_use", {})
        if current_tool.get("name") == "get_temperature":
            saw_tool = True
        if "data" in event:
            print(event["data"], end="", flush=True)

    if not saw_tool:
        raise RuntimeError("The model completed without calling get_temperature")
    print()


if __name__ == "__main__":
    asyncio.run(main())
