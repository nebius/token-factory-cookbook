"""Small CrewAI crew using Token Factory's Chat Completions endpoint."""

from __future__ import annotations

import os

from crewai import LLM, Agent, Crew, Process, Task
from crewai.tools import tool
from dotenv import load_dotenv

TOKEN_FACTORY_BASE_URL = "https://api.tokenfactory.nebius.com/v1"
TOKEN_FACTORY_MODEL = "Qwen/Qwen3-30B-A3B-Instruct-2507"

TOPIC_BRIEFS = {
    "small language models": (
        "Small language models trade some generality for lower latency, lower "
        "serving cost, and easier deployment. Strong evaluations compare quality, "
        "latency, memory use, and task-specific reliability."
    ),
    "tool-using agents": (
        "Tool-using agents combine a language model with deterministic functions. "
        "Production designs validate tool inputs, constrain side effects, and record "
        "tool results for evaluation."
    ),
}


@tool("Look up a technology brief")
def lookup_topic_brief(topic: str) -> str:
    """Return a short, local evidence brief for a technology topic."""
    normalized_topic = topic.strip().lower()
    return TOPIC_BRIEFS.get(
        normalized_topic,
        f"No local brief is available for {topic!r}; state this evidence gap.",
    )


def build_llm(api_key: str | None = None) -> LLM:
    """Configure CrewAI's existing custom OpenAI Chat Completions route."""
    resolved_api_key = api_key or os.getenv("NEBIUS_API_KEY")
    if not resolved_api_key:
        raise RuntimeError("Set NEBIUS_API_KEY before running the crew.")

    return LLM(
        model=TOKEN_FACTORY_MODEL,
        custom_openai=True,
        base_url=TOKEN_FACTORY_BASE_URL,
        api_key=resolved_api_key,
        temperature=0.2,
    )


def build_crew(llm: LLM | None = None) -> Crew:
    """Build a two-agent crew with one deterministic local research tool."""
    configured_llm = llm or build_llm()

    researcher = Agent(
        role="Technology researcher",
        goal="Find the supplied evidence for {topic} and identify its limits.",
        backstory="You separate supplied evidence from inference.",
        tools=[lookup_topic_brief],
        llm=configured_llm,
        verbose=False,
    )
    editor = Agent(
        role="Technical editor",
        goal="Turn research into a concise, evidence-bounded briefing.",
        backstory="You write for engineers and never invent missing evidence.",
        llm=configured_llm,
        verbose=False,
    )

    research = Task(
        description=(
            "Use the local lookup tool for {topic}. Return three supported facts "
            "and one explicit evidence gap."
        ),
        expected_output="Three supported bullets followed by one evidence-gap bullet.",
        agent=researcher,
    )
    briefing = Task(
        description=(
            "Write a briefing of at most 150 words from the research. Clearly "
            "separate evidence from recommendations."
        ),
        expected_output="A short briefing with Evidence and Recommendation headings.",
        agent=editor,
        context=[research],
    )

    return Crew(
        agents=[researcher, editor],
        tasks=[research, briefing],
        process=Process.sequential,
        verbose=False,
    )


def main() -> None:
    """Run the example crew."""
    load_dotenv()
    result = build_crew().kickoff(inputs={"topic": "tool-using agents"})
    print(result.raw)


if __name__ == "__main__":
    main()
