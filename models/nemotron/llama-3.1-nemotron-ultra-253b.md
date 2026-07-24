# Llama-3.1-Nemotron-Ultra-253B-v1

---

## Table of Contents

- [Llama-3.1-Nemotron-Ultra-253B-v1](#llama-31-nemotron-ultra-253b-v1)
  - [Table of Contents](#table-of-contents)
  - [Quickstart](#quickstart)
  - [Try it Out](#try-it-out)
  - [TL;DR](#tldr)
    - [Key highlights](#key-highlights)
  - [Reasoning Mode](#reasoning-mode)
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
    model="nvidia/llama-3_1-nemotron-ultra-253b-v1",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/llama-3_1-nemotron-ultra-253b-v1)

## TL;DR

Llama-3.1-Nemotron-Ultra-253B-v1 is NVIDIA's large-scale dense reasoning model derived from Meta's Llama-3.1-405B-Instruct via Neural Architecture Search (NAS).

- **Provider:** NVIDIA / Meta
- **Architecture:** Dense decoder-only (non-standard Llama blocks via NAS)
- **Parameters:** 253B total
- **Context window:** 128K tokens
- **Strengths:** Advanced reasoning, agentic AI, tool calling, chat, RAG
- **License:** NVIDIA Open Model License + Llama 3.1 Community License

### Key highlights

- Compressed from Llama-3.1-405B via Neural Architecture Search (NAS)
- Architectural innovations include attention skipping, linear layer replacements, variable FFN expansion ratios, and FFN Fusion
- Fits on a single 8x H100-80GB node (BF16) or 4x H100 (FP8)
- Supports toggleable reasoning mode via system prompt
- Trained with knowledge distillation, continual pretraining, supervised fine-tuning, and GRPO reinforcement learning
- Strong performance on math, code, reasoning, and agentic benchmarks

---

## Reasoning Mode

Reasoning is toggled via a special system prompt. Do not add extra system prompts.

| Mode | System Prompt | Recommended Settings |
|------|--------------|---------------------|
| **Reasoning ON** | `detailed thinking on` | `temperature=0.6`, `top_p=0.95` |
| **Reasoning OFF** | `detailed thinking off` | `temperature=0` (greedy decoding) |

---

## Performance and Benchmarks

| Benchmark | Reasoning ON | Reasoning OFF |
|-----------|-------------|---------------|
| GPQA | 76.01% | 56.60% |
| AIME25 | 72.50% | 16.67% |
| MATH500 | 97.00% | 80.40% |
| LiveCodeBench | 66.31% | 29.03% |
| BFCL v2 Live | 74.10% | 73.62% |
| IFEval | 89.45% | 88.85% |

---

## References

- [Llama-3.1-Nemotron-Ultra-253B-v1 on HuggingFace](https://huggingface.co/nvidia/Llama-3_1-Nemotron-Ultra-253B-v1)
- [Technical Report (arXiv:2505.00949)](https://arxiv.org/abs/2505.00949)
- [NVIDIA Blog: Build Enterprise AI Agents with Advanced Open NVIDIA Llama Nemotron Reasoning Models](https://developer.nvidia.com/blog/build-enterprise-ai-agents-with-advanced-open-nvidia-llama-nemotron-reasoning-models/)
