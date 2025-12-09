from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm
from dotenv import load_dotenv


load_dotenv() # load settings from .env file

def convert_to_currency(currency: str, amount: float) -> float:
    """
    Converts a given amount in USD to the specified currency.
    Currently, only conversion to EUR is supported.
    It is just a placeholder for demonstration purposes.

    Args:
        currency (str): The target currency code. Only 'EUR' is supported.
        amount (float): The amount in USD to convert.
    
    Returns:
        dict: If the currency is supported, returns a dict with status 'success' and the converted amount.
              If the currency is not supported, returns a dict with status 'error' and an error message.
    """

    if currency.lower() == 'eur':
        return {
            "status": "success",
            "amount": amount * 2,
        }
    else:
        return {
            "status": "error",
            "error_message": f"conversion for currency '{currency}' is not available.",
        }
## -----end : convert_to_currency ---------



llm = LiteLlm(
    ## Choose a model from the list of available models in the Nebius Token Factory
    model="nebius/openai/gpt-oss-20b",
    # model="nebius/meta-llama/Llama-3.3-70B-Instruct",
    # model="nebius/deepseek-ai/DeepSeek-R1-0528",
    # model="nebius/Qwen/Qwen3-235B-A22B",
    
    ## other settings you may want to use
    # temperature=0.1,
    # max_tokens=1000,
    # top_p=0.95,
    # top_k=40,
)

root_agent = Agent(
    name="currency_agent",
    model= llm,
    description=(
        "Agent to convert USD to other currencies. "
    ),
    instruction=(
        "You are a helpful agent who can convert USD to other currency amounts."
    ),
    tools=[convert_to_currency],
)
