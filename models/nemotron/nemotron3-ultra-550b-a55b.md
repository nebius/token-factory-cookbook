# Nemotron-3-Ultra-550B-A55B

---

## Table of Contents

- [Nemotron-3-Ultra-550B-A55B](#nemotron-3-ultra-550b-a55b)
  - [Table of Contents](#table-of-contents)
  - [Quickstart](#quickstart)
  - [Try it Out](#try-it-out)
  - [TL;DR](#tldr)
    - [Key highlights](#key-highlights)
  - [Reasoning and Tool Calling](#reasoning-and-tool-calling)
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
    model="nvidia/Nemotron-3-Ultra-550b-a55b",
    messages=[{"role": "user", "content": "Explain quantum computing in one sentence."}]
)
print(response.choices[0].message.content)
```

## Try it Out

[▶ Try it in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/Nemotron-3-Ultra-550b-a55b)

## TL;DR

Nemotron-3-Ultra-550B-A55B is NVIDIA's flagship 550B hybrid MoE model on Nebius Token Factory, optimized for demanding multi-agent AI and complex reasoning tasks.

- **Provider:** NVIDIA
- **Flavor:** Base
- **Region:** `us-central1`
- **Architecture:** Hybrid Mixture-of-Experts (MoE) — 550B total / 55B active parameters
- **Context window:** 256K tokens
- **Modality:** Text-to-text
- **Quantization:** FP4
- **Pricing:** \$1.00 / 1M input tokens, \$3.00 / 1M output tokens
- **Strengths:** Complex reasoning, multi-agent workflows, tool calling, long-context tasks
- **License:** `nvidia-open-model-license`

### Key highlights

- Ultra-tier Nemotron 3 model available through Nebius Token Factory
- Activates 55B parameters from a 550B-parameter hybrid MoE architecture
- Supports reasoning and tool calling for agentic workflows
- Runs on the `us-central1` Token Factory endpoint
- Exposes an OpenAI-compatible chat completions API

---

## Reasoning and Tool Calling

| Capability | Availability |
|------------|--------------|
| Reasoning | Available |
| Tool calling | Available |
| Recommended endpoint | `https://api.tokenfactory.us-central1.nebius.com/v1/` |
| Model ID | `nvidia/Nemotron-3-Ultra-550b-a55b` |

---

## References

- [Nemotron-3-Ultra-550B-A55B in the Token Factory Playground](https://tokenfactory.nebius.com/playground?models=nvidia/Nemotron-3-Ultra-550b-a55b)
- [NVIDIA Nemotron 3 Ultra](https://research.nvidia.com/labs/nemotron/Nemotron-3-Ultra/)
- [Nemotron-3-Ultra-550B-A55B on NVIDIA NIM](https://build.nvidia.com/nvidia/nemotron-3-ultra-550b-a55b/build)
