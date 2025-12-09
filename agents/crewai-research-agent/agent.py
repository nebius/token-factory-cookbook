from crewai import Agent, Task,LLM
import os
from dotenv import load_dotenv
from crewai import Crew, Process

load_dotenv()

## https://docs.crewai.com/en/learn/llm-connections#using-the-llm-class
llm=LLM(
        model="nebius/openai/gpt-oss-20b-Instruct-2507",
        # model="nebius/deepseek-ai/DeepSeek-R1-0528",
        api_key=os.getenv("NEBIUS_API_KEY")
)

# Create a researcher agent
## see documentation : https://docs.crewai.com/en/concepts/agents#direct-code-definition
researcher = Agent(
  role='Senior Researcher',
  goal='Discover groundbreaking technologies',
  verbose=True,
  llm=llm,
  backstory='A curious mind fascinated by cutting-edge innovation and the potential to change the world, you know everything about tech.'
)

# Task for the researcher
research_task = Task(
  description='Identify the next big trend in AI',
  expected_output='5 paragraphs on the next big AI trend',
  agent=researcher  # Assigning the task to the researcher
)

# Instantiate your crew
tech_crew = Crew(
  agents=[researcher],
  tasks=[research_task],
  process=Process.sequential  # Tasks will be executed one after the other
)

# Begin the task execution
result = tech_crew.kickoff()

## see raw response
## Look at `token_usage` output
# print("=== CREW OUTPUT ===")
# print(result.raw)
print("\n=== TOKEN USAGE ===")
print(f"Total tokens: {result.token_usage.total_tokens}")
print(f"Prompt tokens: {result.token_usage.prompt_tokens}")
print(f"Completion tokens: {result.token_usage.completion_tokens}")
print(f"Successful requests: {result.token_usage.successful_requests}")
