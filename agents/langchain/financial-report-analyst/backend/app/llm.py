from __future__ import annotations

from typing import Any

from app.config import settings


def reasoning_model() -> Any:
    extra_body = {"chat_template_kwargs": {"enable_thinking": True, "force_nonempty_content": True}}
    try:
        from langchain_nebius import ChatNebius

        return ChatNebius(
            model=settings.reasoning_model,
            api_key=settings.nebius_api_key,
            base_url=settings.reasoning_base_url,
            temperature=1.0,
            top_p=0.95,
            max_tokens=5000,
            timeout=settings.model_timeout_seconds,
            max_retries=1,
            extra_body=extra_body,
        )
    except Exception:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=settings.reasoning_model,
            api_key=settings.nebius_api_key,
            base_url=settings.reasoning_base_url,
            temperature=1.0,
            top_p=0.95,
            max_tokens=5000,
            timeout=settings.model_timeout_seconds,
            max_retries=1,
            extra_body=extra_body,
        )
