# RAG Example with LLama-Index + Nebius

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/rag/rag-pdf-llama-index/rag_pdf_query.ipynb)
[![](https://img.shields.io/badge/Powered%20by-Nebius%20AI-orange?style=flat&labelColor=orange&color=green)](http://tokenfactory.nebius.com/)

This example shows querying a PDF using  [llama index](https://docs.llamaindex.ai/en/stable/) framework and running LLM on [Nebius Token Factory](https://tokenfactory.nebius.com/)


## References and Acknowledgements

- [llamaindex documentation](https://docs.llamaindex.ai/en/stable/)
- [Nebius Token Factory](https://tokenfactory.nebius.com/)
- [Nebius Token Factory documentation](https://docs.tokenfactory.nebius.com//inference/quickstart)


## Features

- Minimal RAG application for querying PDF documents
- **Tech Stack**
  - RAG framework: [llamaindex](https://docs.llamaindex.ai/)
  - open source embedding models: [BAAI/bge-small-en](https://huggingface.co/BAAI/bge-small-en) (fast and good performance) ,  [BAAI/bge-en-icl](https://huggingface.co/BAAI/bge-en-icl) (large and more accurate) etc.
  - powerful open source LLMs: **meta-llama/Llama-3.3-70B-Instruct**  or **openai/gpt-oss-20b**
  - [Nebius Token Factory](https://tokenfactory.nebius.com) to run models and embeddings
- Run embedding models locally or on the cloud


## Pre requisites

- Nebius API key.  Sign up for free at [Token Factory](https://tokenfactory.nebius.com/)

## Run the code

[rag_pdf_query.ipynb](rag_pdf_query.ipynb)

### Option-1 (Easy!):  On Google Colab

No setup required.

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/rag/rag-pdf-llama-index/rag_pdf_query.ipynb)

### Option-2: Run locally

#### 2A (Preferred): Using `uv`

Install dependencies

```bash
uv  sync
```

Run notebook

```bash
uv run --with jupyter jupyter lab rag_pdf_query.ipynb
```

#### 2B: Using pip

```bash
pip install -r requirements.txt
```

```bash
jupyter lab  rag_pdf_query.ipynb
```

## Dev Notes

How the uv project was created.

```bash
uv init .
uv add -r requirements.txt
uv add --dev ipykernel   # for jupyter kernel
uv sync

# create a kernel to use uv env within vscode
source  .venv/bin/activate
uv run python -m ipykernel install --user --name=$(basename $(pwd)) --display-name "$(basename $(pwd))"
```

