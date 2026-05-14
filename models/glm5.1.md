# GLM-5.1

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
    model="zai-org/GLM-5.1",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=zai-org/GLM-5.1)

## TL;DR

GLM-5.1 is Z.ai's incremental update to GLM-5, refining reasoning, agentic capabilities, and tool use while improving efficiency and instruction following.

- **Provider:** Z.ai (Zhipu AI)
- **Architecture:** Mixture-of-Experts (MoE)
- **Strengths:** Agentic tasks, tool calling, multilingual reasoning, coding
- **License:** MIT

### Key highlights

- Successor to GLM-5 — improved reasoning quality and stability
- Native function calling and agentic workflow support
- Hybrid reasoning system: extended thinking mode + fast response mode
- Built on Z.ai's "Slime" RL infrastructure for complex agentic behavior

---

## Performance and Benchmarks

See official benchmarks on the [GLM-5.1 HuggingFace page](https://huggingface.co/zai-org/GLM-5.1).

---

## References

- [GLM-5.1 on HuggingFace](https://huggingface.co/zai-org/GLM-5.1)
- [Z.ai Blog](https://z.ai/blog)
- [GLM-5 guide](glm5.md) — predecessor
- [GLM-4.5 guide](glm4.5.md) — earlier generation with detailed benchmarks
