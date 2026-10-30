# Nemotron-3-Nano-30B-A3B

---

## Table of Contents

- [Nemotron-3-Nano-30B-A3B](#nemotron-3-nano-30b-a3b)
  - [Table of Contents](#table-of-contents)
  - [Quickstart](#quickstart)
  - [Reasoning replies truncated by `max_tokens`](#reasoning-replies-truncated-by-max_tokens)
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
    model="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Reasoning replies truncated by `max_tokens`

Nemotron-3-Nano-30B-A3B is a reasoning model. If `max_tokens` runs out while it is still thinking, the API returns HTTP 200 with `finish_reason: "length"` and `content: null`; the partial thinking text sits in a field named `reasoning` on the message object. Clients that fall back to `reasoning_content` (the field name some other providers use) find nothing and end up with an empty answer.

Read the reply defensively and detect truncation:

```python
choice = response.choices[0]
text = choice.message.content or getattr(choice.message, "reasoning", None)
if choice.finish_reason == "length":
    # reply was cut off mid-thought; retry with a larger max_tokens
    ...
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B)

## TL;DR

Nemotron-3-Nano-30B-A3B is a small, efficient MoE model from NVIDIA, designed for edge deployment and cost-sensitive applications.

- **Provider:** NVIDIA
- **Architecture:** Mixture-of-Experts (MoE) — 30B total / 3B active parameters
- **Context window:** 262K tokens
- **Strengths:** Edge inference, cost efficiency, low latency
- **License:** NVIDIA Open Model License

### Key highlights

- Only 3B active parameters per token keeps inference fast and cheap
- Ideal for edge and on-device deployment where compute is limited
- Strong performance-per-compute for its size class
- Supports function calling and structured output

---

## Performance and Benchmarks

See official benchmarks on the [Nemotron HuggingFace page](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16).

---

## References

- [Nemotron-3-Nano-30B-A3B on HuggingFace](https://huggingface.co/nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-BF16)
