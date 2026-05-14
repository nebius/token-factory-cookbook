# Qwen3.5-397B-A17B

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
    model="Qwen/Qwen3.5-397B-A17B",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=Qwen/Qwen3.5-397B-A17B)

## TL;DR

Qwen3.5-397B-A17B is Alibaba's latest flagship MoE model, delivering state-of-the-art performance in reasoning, coding, mathematics, and multilingual tasks.

- **Provider:** Alibaba / Qwen
- **Architecture:** Mixture-of-Experts (MoE) — 397B total / 17B active parameters
- **Context window:** 262K tokens
- **Strengths:** Complex reasoning, coding, math, long-context understanding
- **License:** Apache 2.0

### Key highlights

- Successor to Qwen3-235B — larger expert pool with similar inference cost
- Supports hybrid thinking mode (extended reasoning on-demand)
- Strong multilingual coverage across 100+ languages
- Excels on coding benchmarks (HumanEval, LiveCodeBench)

---

## Performance and Benchmarks

See official benchmarks on the [Qwen3.5 HuggingFace page](https://huggingface.co/Qwen/Qwen3.5-397B-A17B).

---

## References

- [Qwen3.5 on HuggingFace](https://huggingface.co/Qwen/Qwen3.5-397B-A17B)
- [Qwen Blog](https://qwenlm.github.io/)
