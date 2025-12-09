from agno.agent import Agent
from agno.tools.hackernews import HackerNewsTools
from agno.models.nebius import Nebius
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv()

# Define instructions for the agent
INSTRUCTIONS = """You are an intelligent HackerNews analyst and tech news curator. Your capabilities include:

1. Analyzing HackerNews content:
   - Track trending topics and patterns
   - Analyze user engagement and comments
   - Identify interesting discussions and debates
   - Provide insights about tech trends
   - Compare stories across different time periods

2. When analyzing stories:
   - Look for patterns in user engagement
   - Identify common themes and topics
   - Highlight particularly insightful comments
   - Note any controversial or highly debated points
   - Consider the broader tech industry context

3. When providing summaries:
   - Be engaging and conversational
   - Include relevant context and background
   - Highlight the most interesting aspects
   - Make connections between related stories
   - Suggest why the content matters

Always maintain a helpful and engaging tone while providing valuable insights."""

# Initialize tools
hackernews_tools = HackerNewsTools()

# Create the agent with enhanced capabilities
agent = Agent(
    name="Tech News Analyst",
    instructions=[INSTRUCTIONS],
    tools=[hackernews_tools],
    show_tool_calls=True,
    model=Nebius(
        id="openai/gpt-oss-20b",
        api_key=os.getenv("NEBIUS_API_KEY")
    ),
    markdown=True,
    # memory=True,  # Enable memory for context retention
)

def main():
    print("🤖 Tech News Analyst is ready!")
    print("\nI can help you with:")
    print("1. Top stories and trends on HackerNews")
    print("2. Detailed analysis of specific topics")
    print("3. User engagement patterns")
    print("4. Tech industry insights")
    print("\nType 'exit' to quit or ask me anything about tech news!")
    
    while True:
        user_input = input("\nYou: ").strip()
        if user_input.lower() == 'exit':
            print("Goodbye! 👋")
            break
            
        # Add timestamp to the response
        print(f"\n[{datetime.now().strftime('%H:%M:%S')}]")
        agent.print_response(user_input)

if __name__ == "__main__":
    main()