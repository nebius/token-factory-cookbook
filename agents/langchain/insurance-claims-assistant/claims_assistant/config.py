"""Configuration and the LangChain chat models for Nebius Token Factory.

Both Nebius models are reached through LangChain's `ChatOpenAI` (the same wrapper the
repo's other LangChain agents use) pointed at the Token Factory OpenAI-compatible
endpoint. Model IDs and the base URL are read from the environment first so you can swap
models without touching code.
"""

from __future__ import annotations

import os
from functools import lru_cache

from dotenv import load_dotenv
from langchain_openai import ChatOpenAI

# Load a folder-local .env first, then any ambient .env, so running from either the
# project directory or the repo root both work.
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))
load_dotenv()

# Current Token Factory endpoint (OpenAI-compatible).
BASE_URL = os.getenv("NEBIUS_BASE_URL", "https://api.tokenfactory.nebius.com/v1/")

# The reasoning brain: a text LLM with strong reasoning + tool-calling.
TEXT_MODEL = os.getenv("TEXT_MODEL", "nvidia/Llama-3_1-Nemotron-Ultra-253B-v1")

# The eyes: the Cosmos 3 vision-language "Reasoner" tower. If your workspace serves it
# under a different id (e.g. "nvidia/Cosmos3-Super"), set VISION_MODEL in your .env.
VISION_MODEL = os.getenv("VISION_MODEL", "nvidia/Cosmos3-Super-Reasoner")


def _require_api_key() -> str:
    key = os.getenv("NEBIUS_API_KEY")
    if not key:
        raise RuntimeError(
            "Set NEBIUS_API_KEY in the environment or this folder's .env file "
            "(copy env.example to .env). Get a key at https://tokenfactory.nebius.com/"
        )
    return key


def _build(model: str, temperature: float, max_tokens: int) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        api_key=_require_api_key(),
        base_url=BASE_URL,
        temperature=temperature,
        max_tokens=max_tokens,
    )


@lru_cache(maxsize=1)
def text_llm(temperature: float = 0.1, max_tokens: int = 4096) -> ChatOpenAI:
    """The Nemotron reasoning model, as a LangChain chat model."""
    return _build(TEXT_MODEL, temperature, max_tokens)


@lru_cache(maxsize=1)
def vision_llm(temperature: float = 0.0, max_tokens: int = 1200) -> ChatOpenAI:
    """The Cosmos3 vision-language model, as a LangChain chat model."""
    return _build(VISION_MODEL, temperature, max_tokens)
