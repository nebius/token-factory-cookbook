import json

from deepagents import create_deep_agent
from langchain_nebius import ChatNebius
from langchain.chat_models import init_chat_model
from dotenv import load_dotenv

load_dotenv()

model = ChatNebius(
    # model="Qwen/Qwen3 -30B-A3B-Instruct-2507",
    model="moonshotai/Kimi-K2.5"
)

agent = create_deep_agent(model=model)

result = agent.invoke({
    "messages": [
        {"role": "user",
        "content": "Research EVs available in US in 2026 and write a report"
        }
    ]})

print(json.dumps(result, indent=4, default=str))