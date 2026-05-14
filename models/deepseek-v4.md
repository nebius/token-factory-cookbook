# DeepSeek V4 Pro

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
    model="deepseek-ai/DeepSeek-V4-Pro",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=deepseek-ai/DeepSeek-V4-Pro)

## TL;DR

DeepSeek V4 Pro is DeepSeek's latest frontier open model, pushing the state of the art in reasoning, coding, and math while remaining openly available.

- **Provider:** DeepSeek AI
- **Architecture:** Mixture-of-Experts (MoE) — 1.6T total / 49B active parameters
- **Context window:** 1M tokens
- **Strengths:** Reasoning, coding, mathematics, scientific tasks
- **License:** DeepSeek Model License

### Key highlights

- Successor to DeepSeek-V3 — improved reasoning depth and instruction following
- Competitive with proprietary frontier models on coding and math benchmarks
- Efficient MoE architecture keeps inference costs low despite large total parameter count
- Strong performance on AIME, MATH, and LiveCodeBench

---

## Performance and Benchmarks

See official benchmarks on the [DeepSeek HuggingFace page](https://huggingface.co/deepseek-ai).

---

## References

- [DeepSeek AI on HuggingFace](https://huggingface.co/deepseek-ai)
- [DeepSeek Blog](https://www.deepseek.com/)
