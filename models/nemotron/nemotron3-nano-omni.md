# Nemotron-3-Nano-Omni

---

## Table of Contents

- [Nemotron-3-Nano-Omni](#nemotron-3-nano-omni)
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
    model="nvidia/nemotron-3-nano-omni",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/nemotron-3-nano-omni)

## TL;DR

Nemotron-3-Nano-Omni is NVIDIA's compact multimodal model, supporting vision, video, and text understanding.

- **Provider:** NVIDIA
- **Architecture:** Nano family
- **Context window:** 128K tokens
- **Strengths:** Multimodal (vision, video, text), edge deployment, on-device AI
- **License:** NVIDIA Open Model License

### Key highlights

- Understands images, video, and text in a single model
- Compact size optimized for edge and on-device scenarios
- Efficient inference for real-time multimodal applications
- Strong performance on vision-language benchmarks

---

## Performance and Benchmarks

See official benchmarks on the [Nemotron HuggingFace page](https://huggingface.co/nvidia/nemotron-3-nano-omni).

---

## References

- [Nemotron-3-Nano-Omni on HuggingFace](https://huggingface.co/nvidia/nemotron-3-nano-omni)
