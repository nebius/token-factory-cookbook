"""Vision helper + JSON extraction, on top of LangChain chat models.

The reasoning model is driven directly with `ChatOpenAI.bind_tools(...)` in `agent.py`
(the repo's LangChain agent pattern). This module only wraps the one thing that isn't a
plain tool loop — sending an image to the Cosmos3 model — plus the defensive JSON parser
used by the repo's incident-response-agent.
"""

from __future__ import annotations

import re

from langchain_core.messages import HumanMessage

from .config import vision_llm


def chat_vision(image_data_url: str, prompt: str) -> str:
    """Send one image + instruction to the vision model and return its text answer.

    `image_data_url` is either a remote http(s) URL or a base64 `data:` URL. The Cosmos3
    Reasoner follows the standard OpenAI/Qwen-VL `image_url` content-block convention, so
    both forms work.
    """
    message = HumanMessage(
        content=[
            {"type": "image_url", "image_url": {"url": image_data_url}},
            {"type": "text", "text": prompt},
        ]
    )
    response = vision_llm().invoke([message])
    content = response.content
    return content.strip() if isinstance(content, str) else str(content)


def extract_json(text: str) -> str:
    """Pull a single JSON object out of a possibly chatty / fenced model response."""
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:json)?", "", cleaned, flags=re.IGNORECASE).strip()
    cleaned = re.sub(r"```$", "", cleaned).strip()
    if cleaned.startswith("{") and cleaned.endswith("}"):
        return cleaned
    match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
    if not match:
        raise ValueError(f"Model response did not contain JSON: {cleaned[:300]}")
    return match.group(0)
