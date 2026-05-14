# Kimi-K2.5-fast

---

## Table of Contents

- [Quickstart](#quickstart)
- [Try it Out](#try-it-out)
- [TL;DR](#tldr)
- [Performance and Benchmarks](#performance-and-benchmarks)
- [References](#references)

---

## Quickstart

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://api.tokenfactory.us-central1.nebius.com/v1/",
    api_key=os.environ.get("NEBIUS_API_KEY")
)

response = client.chat.completions.create(
    model="moonshotai/Kimi-K2.5-fast",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=moonshotai/Kimi-K2.5-fast)

## TL;DR

Kimi-K2.5-fast is Moonshot AI's speed-optimized variant of the Kimi K2.5 model, delivering strong reasoning and coding capabilities with significantly reduced latency.

- **Provider:** Moonshot AI
- **Context window:** 256K tokens
- **Strengths:** Low latency, reasoning, coding, agentic tasks
- **License:** Moonshot AI Model License

### Key highlights

- Speed-optimized variant of Kimi K2.5 — lower latency without major quality trade-offs
- Strong agentic and tool-use capabilities inherited from the K2.5 base
- Particularly well-suited for real-time applications and interactive agents
- Competitive coding and reasoning performance at fast inference speeds

---

## Performance and Benchmarks

See official benchmarks on the [Kimi K2.5 HuggingFace page](https://huggingface.co/moonshotai/Kimi-K2.5-fast).

---

## References

- [Kimi-K2.5 on HuggingFace](https://huggingface.co/moonshotai/Kimi-K2.5)
- [Moonshot AI Blog](https://moonshot.ai/)
