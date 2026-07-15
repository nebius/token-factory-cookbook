# Pixeltable + Nebius Token Factory

[Pixeltable](https://pixeltable.com/) is open-source multimodal AI data infrastructure. You declare tables with images, video, audio, documents, and text; computed columns and embedding indexes run incrementally as data arrives. Pixeltable includes a **native Nebius Token Factory provider** (`pixeltable.functions.nebius`) for chat completions and embeddings—no custom base-URL wiring required.

## Why Token Factory?

- **Native UDFs** — `nebius.chat_completions` and `nebius.embeddings` call Token Factory directly.
- **Open models** — Llama, Qwen, DeepSeek, and more behind one API key.
- **Incremental pipelines** — insert rows; Pixeltable fills computed columns and maintains indexes automatically.

## Prerequisites

- A Nebius Token Factory API key — see [Getting Started](../../getting-started.md).
- Python 3.10+ (local, Colab, etc.).

## 1. Install

```bash
pip install -U pixeltable openai
```

Nebius uses an OpenAI-compatible API, so the `openai` package is required alongside Pixeltable.

## 2. Set your API key

```bash
export NEBIUS_API_KEY=your_key_here
```

Or in Python:

```python
import os
os.environ['NEBIUS_API_KEY'] = 'your_key_here'
```

## 3. Chat completions

```python
import pixeltable as pxt
from pixeltable.functions import nebius

pxt.drop_dir('nebius_demo', force=True)
pxt.create_dir('nebius_demo')

chat_t = pxt.create_table('nebius_demo/chat', {'input': pxt.String})
messages = [{'role': 'user', 'content': chat_t.input}]

chat_t.add_computed_column(
    output=nebius.chat_completions(
        messages=messages,
        model='meta-llama/Llama-3.3-70B-Instruct',
        model_kwargs={'max_tokens': 300, 'temperature': 0.7},
    )
)
chat_t.add_computed_column(response=chat_t.output.choices[0].message.content)

chat_t.insert([{'input': 'What is the capital of France?'}])
chat_t.select(chat_t.input, chat_t.response).collect()
```

Model IDs use the `org/model` form. Browse the catalog at [tokenfactory.nebius.com](https://tokenfactory.nebius.com/) or the [Models guides](../../models/) in this cookbook.

## 4. Embeddings

Token Factory currently serves `Qwen/Qwen3-Embedding-8B`. By default it returns **4096-dimensional** vectors, which exceed Pixeltable’s embedding-index limit of 4000. Request a truncated size when you need an index:

```python
emb_t = pxt.create_table('nebius_demo/embeddings', {'input': pxt.String})
emb_t.add_computed_column(
    embedding=nebius.embeddings(
        input=emb_t.input, model='Qwen/Qwen3-Embedding-8B'
    )
)

# For similarity search / RAG indexes, truncate to an indexable size:
indexed = nebius.embeddings.using(
    model='Qwen/Qwen3-Embedding-8B',
    model_kwargs={'dimensions': 1024},
)
emb_t.add_embedding_index('input', embedding=indexed)

emb_t.insert([{'input': 'Nebius Token Factory provides open models via API.'}])
sim = emb_t.input.similarity(string='open models API')
emb_t.select(emb_t.input, sim=sim).order_by(sim, asc=False).collect()
```

## Troubleshooting

- **401 Unauthorized** — confirm `NEBIUS_API_KEY` is set in the environment.
- **404 / model not found** — check the model ID (`org/model`, case-sensitive) against your Token Factory catalog.
- **Embedding index errors** — use `model_kwargs={'dimensions': 1024}` (or another size ≤ 4000) with `Qwen/Qwen3-Embedding-8B`.

## Resources

- [Pixeltable docs](https://docs.pixeltable.com/)
- [Pixeltable Nebius provider guide](https://docs.pixeltable.com/howto/providers/working-with-nebius)
- [Pixeltable Nebius SDK reference](https://docs.pixeltable.com/sdk/latest/nebius)
- [Token Factory docs](https://docs.tokenfactory.nebius.com/)
- [Cookbook: Getting Started](../../getting-started.md)
