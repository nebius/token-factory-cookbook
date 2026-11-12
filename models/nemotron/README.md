# NVIDIA Nemotron Models

Browse NVIDIA Nemotron models available on [Nebius Token Factory](https://tokenfactory.nebius.com/models).

---

## Available Nemotron Models

| Model | Provider | Parameters | Context | Highlights |
|-------|----------|------------|---------|------------|
| [Nemotron-3.5-Lightning](run_nemotron.ipynb)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/Nemotron-3_5-Lightning) | NVIDIA | 30B total <br> 3B active | 1 M | Fast, low-cost MoE model built as the execution layer for always-on, long-running agents and high-throughput specialized tasks |
| [Nemotron-3-Super-120B-A12B](nemotron3-super-120B.md)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/nemotron-3-super-120b-a12b) | NVIDIA | 120B total <br> 12B active | 256 K | hybrid MoE model optimized for efficient multi-agent AI and complex reasoning tasks. |
| [Nemotron-3-Ultra-550B-A55B](nemotron3-ultra-550b-a55b.md)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/Nemotron-3-Ultra-550b-a55b) | NVIDIA | 550B total <br> 55B active | 1 M | Flagship hybrid MoE model optimized for the most demanding multi-agent AI and complex reasoning tasks |

<!-- Models not currently featured:
| [Nemotron-3-Nano-30B-A3B](nemotron3-nano-30b.md)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B) | NVIDIA | 30B total <br> 3B active | 262 K | Compact MoE model optimized for efficient reasoning, chat, and coding with strong multilingual support and long-context RAG/agent workflows |
| [Nemotron-3-Nano-Omni](nemotron3-nano-omni.md)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/Nemotron-3-Nano-Omni) | NVIDIA | 30 B total <br> 3 B active | 262 K | The most open, efficient, and accurate omni-modal reasoning model for agentic AI |
| [Llama-3.1-Nemotron-Ultra-253B-v1](llama-3.1-nemotron-ultra-253b.md)<br><br>[▶ Try it  @ TF](https://tokenfactory.nebius.com/playground?models=nvidia/Llama-3_1-Nemotron-Ultra-253B-v1) | NVIDIA / Meta | 253 B | 128 K | NVIDIA-tuned Llama variant built for high-efficiency reasoning, safety, and enterprise-grade performance |
-->

---

## Running the Notebooks

This directory is a [uv](https://docs.astral.sh/uv/) project. From the repo root:

```bash
cd models/nemotron
uv sync
```

Create a `.env` file with your Nebius API key (get one at [tokenfactory.nebius.com](https://tokenfactory.nebius.com/)):

```bash
cp env.example .env
# then edit .env and paste your key
```

Start Jupyter and open a notebook:

```bash
uv run jupyter lab run_nemotron.ipynb
```

| Notebook | Model | Runs on |
|----------|-------|---------|
| [run_nemotron.ipynb](run_nemotron.ipynb) | `nvidia/Nemotron-3_5-Lightning` | Local (minimal) |
| [run_nemotron_colab.ipynb](run_nemotron_colab.ipynb) | `nvidia/Nemotron-3_5-Lightning` | Google Colab or local |
