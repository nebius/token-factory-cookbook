from dotenv import load_dotenv
from google.adk.agents import Agent
from google.adk.models.lite_llm import LiteLlm

from .config import load_token_factory_config


def convert_to_currency(currency: str, amount: float) -> dict[str, str | float]:
    """Convert a USD amount to EUR for this tool-calling demonstration."""
    if currency.upper() == "EUR":
        return {
            "status": "success",
            "amount": amount * 0.86,
            "currency": "EUR",
        }
    return {
        "status": "error",
        "error_message": f"Conversion to {currency.upper()} is not available.",
    }


load_dotenv()
token_factory = load_token_factory_config()

llm = LiteLlm(**token_factory.litellm_kwargs())

root_agent = Agent(
    name="currency_agent",
    model=llm,
    description="Converts USD amounts to supported currencies.",
    instruction="Use the currency conversion tool for every conversion request.",
    tools=[convert_to_currency],
)
