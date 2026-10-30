[Cookbook](../README.md) / APIs

# API and SDK examples

Call open models on Nebius Token Factory through its OpenAI-compatible API, or connect a framework you already use.

Start with [environment setup](../start-here/setup.md). Each notebook lists its dependencies and model configuration.

| Example | Purpose | Dependencies |
| --- | --- | --- |
| [Native API](api_native.ipynb) | Make a direct request with the OpenAI SDK | [requirements.txt](requirements.txt) |
| [Comparing models](comparing-models/README.md) | Run the same text prompt across models and save answers, time, and token usage | [requirements.txt](comparing-models/requirements.txt) |
| [LiteLLM](api_litellm.ipynb) | Use Token Factory through LiteLLM | [requirements-litellm.txt](requirements-litellm.txt) |
| [aisuite](api_aisuite.ipynb) | Call Token Factory through a provider interface | [requirements-aisuite.txt](requirements-aisuite.txt) |
| [LlamaIndex](api_llamaindex.ipynb) | Use chat and embeddings in a LlamaIndex workflow | [requirements-llamaindex.txt](requirements-llamaindex.txt) |

Also see [batch inference](../batch.ipynb) and [guided JSON output](../guided_json.ipynb).

## Run a notebook

From this directory, create a Python environment and install the requirements for the notebook you chose:

```bash
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
uv pip install jupyterlab
python -m jupyter lab
```

Use the corresponding requirements file for the other notebooks. Keep your API key in the environment or in the recipe's local `.env` file.

## Continue building

- [Tool calling](../tool-calling/README.md)
- [Agent examples](../agents/README.md)
- [Official documentation](https://docs.tokenfactory.nebius.com/)
- [Official integrations catalog](https://docs.tokenfactory.nebius.com/integrations/overview)
