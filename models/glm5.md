# GLM-5

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
    model="zai-org/GLM-5",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=zai-org/GLM-5)

## TL;DR

GLM-5 is Z.ai's next-generation open-source model, building on the strengths of GLM-4.5 with improved reasoning, agentic capabilities, and tool use.

- **Provider:** Z.ai (Zhipu AI)
- **Architecture:** Mixture-of-Experts (MoE) — 744B total / 40B active parameters
- **Context window:** 200K tokens
- **Strengths:** Agentic tasks, tool calling, multilingual reasoning, coding
- **License:** MIT

### Key highlights

- Successor to GLM-4.5 — stronger reasoning and instruction following
- Native function calling and agentic workflow support
- Hybrid reasoning system: extended thinking mode + fast response mode
- Built on Z.ai's "Slime" RL infrastructure for complex agentic behavior

---

## Performance and Benchmarks

See official benchmarks on the [GLM-5 HuggingFace page](https://huggingface.co/zai-org/GLM-5).

---

## References

- [GLM-5 on HuggingFace](https://huggingface.co/zai-org/GLM-5)
- [Z.ai Blog](https://z.ai/blog)
- [GLM-4.5 guide](glm4.5.md) — predecessor with detailed benchmarks
