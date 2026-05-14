# Nemotron-3-Super-120B-A12B

---

## Table of Contents

- [Nemotron-3-Super-120B-A12B](#nemotron-3-super-120b-a12b)
  - [Table of Contents](#table-of-contents)
  - [Quickstart](#quickstart)
  - [Try it Out](#try-it-out)
  - [TL;DR](#tldr)
    - [Key highlights](#key-highlights)
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
    model="nvidia/nemotron-3-super-120b-a12b",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/nemotron-3-super-120b-a12b)

## TL;DR

Nemotron-3-Super-120B-A12B is NVIDIA's enterprise-optimized MoE model, balancing high capability with efficient inference for production deployments.

- **Provider:** NVIDIA
- **Architecture:** Mixture-of-Experts (MoE) — 120B total / 12B active parameters
- **Context window:** 128K tokens
- **Strengths:** Enterprise inference, instruction following, tool use, low latency
- **License:** NVIDIA Open Model License

### Key highlights

- Designed for efficient enterprise deployment — only 12B active parameters keeps inference fast
- Built on NVIDIA's Minitron pruning and distillation pipeline
- Strong performance-per-compute ratio vs. dense models of similar capability
- Supports function calling and structured output out of the box

---

## Performance and Benchmarks

See official benchmarks on the [Nemotron HuggingFace page](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4).

---

## References

- [Nemotron on HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16)
- [NVIDIA NIM Blog](https://developer.nvidia.com/blog)
