import json

from deepagents import create_deep_agent
from langchain_nebius import ChatNebius
from langchain.chat_models import init_chat_model
from dotenv import load_dotenv

load_dotenv()

model = ChatNebius(
    model="MiniMaxAI/MiniMax-M3"
)

agent = create_deep_agent(model=model)

result = agent.invoke({
    "messages": [
        {"role": "user",
        "content": "Research EVs available in US in 2026 and write a report"
        }
    ]})

print(json.dumps(result, indent=4, default=str))
