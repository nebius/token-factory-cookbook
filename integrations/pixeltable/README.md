# Pixeltable + Nebius Token Factory

[Pixeltable](https://pixeltable.com/) is open-source multimodal AI data
infrastructure. You declare tables with images, video, audio, documents, and
text; computed columns and embedding indexes run incrementally as data arrives.
Pixeltable includes a **native Nebius Token Factory provider**
(`pixeltable.functions.nebius`) for chat completions and embeddings—no custom
base-URL wiring required.

## Why Token Factory?

- **Native UDFs** — `nebius.chat_completions` and `nebius.embeddings` call
  Token Factory directly.
- **Open models** — Llama, Qwen, DeepSeek, and more behind one API key.
- **Incremental pipelines** — insert rows; Pixeltable fills computed columns
  and maintains indexes automatically.

## Prerequisites

- A Nebius Token Factory API key — see [Getting Started](../../getting-started.md).
- Python 3.10+ (local, Colab, etc.).

This recipe was contract-checked with Pixeltable 0.7.1 on 2026-08-13. It uses
Pixeltable's existing native Nebius UDFs and Chat Completions; it does not add
another provider or claim Responses API support.

## 1. Install

```bash
pip install "pixeltable==0.7.1" openai
```

Nebius uses an OpenAI-compatible API, so the `openai` package is required
alongside Pixeltable.

## 2. Set your API key

```bash
export NEBIUS_API_KEY=your_key_here
```

Keep the key outside notebooks and source control. For a local notebook, set the
environment variable in the shell that launches Jupyter rather than saving a
key assignment in a cell.

## 3. Chat completions

```python
import os

import pixeltable as pxt
from pixeltable.functions import nebius

CHAT_MODEL = os.getenv(
    'NEBIUS_CHAT_MODEL', 'meta-llama/Llama-3.3-70B-Instruct'
)

pxt.drop_dir('nebius_demo', force=True)
pxt.create_dir('nebius_demo')

chat_t = pxt.create_table('nebius_demo/chat', {'input': pxt.String})
messages = [{'role': 'user', 'content': chat_t.input}]

chat_t.add_computed_column(
    output=nebius.chat_completions(
        messages=messages,
        model=CHAT_MODEL,
        model_kwargs={'max_tokens': 300, 'temperature': 0.7},
    )
)
chat_t.add_computed_column(response=chat_t.output.choices[0].message.content)

chat_t.insert([{'input': 'What is the capital of France?'}])
chat_t.select(chat_t.input, chat_t.response).collect()
```

Model IDs use the `org/model` form. The default above was present in the public
catalog when this recipe was checked; use `NEBIUS_CHAT_MODEL` to select another
model without editing the example. Browse the
[live catalog](https://tokenfactory.nebius.com/) before running because model
availability is lifecycle-dependent.

## 4. Embeddings

Token Factory currently serves `Qwen/Qwen3-Embedding-8B`. By default it returns
**4096-dimensional** vectors, which exceed Pixeltable’s embedding-index limit
of 4000. Request a truncated size when you need an index:

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
- **404 / model not found** — check the model ID (`org/model`, case-sensitive)
  against your Token Factory catalog.
- **Embedding index errors** — use `model_kwargs={'dimensions': 1024}` (or
  another size ≤ 4000) with `Qwen/Qwen3-Embedding-8B`.
- **Different chat model** — export `NEBIUS_CHAT_MODEL=org/model` after checking
  that the selected model supports the features you use.

## Resources

- [Pixeltable docs](https://docs.pixeltable.com/)
- [Pixeltable Nebius provider guide](https://docs.pixeltable.com/howto/providers/working-with-nebius)
- [Pixeltable Nebius SDK reference](https://docs.pixeltable.com/sdk/latest/nebius)
- [Token Factory docs](https://docs.tokenfactory.nebius.com/)
- [Cookbook: Getting Started](../../getting-started.md)
