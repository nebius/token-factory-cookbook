# Run models on Nebius Token Factory using APIs

This guide shows how to run models using various python APIs.

## References and Acknowledgements

- [API documentation](https://docs.tokenfactory.nebius.com/api-reference/introduction)
- [Quickstart](https://docs.tokenfactory.nebius.com/quickstart)

## Prerequisites

- NEBIUS_API_KEY

## Setup Python Env

- Be sure to finish [the setup](../getting-started.md)
- And install the requirements

```bash
# follow the seutp-dev-env.md guide above to set up your python env.

# activate the python env
source  .venv/bin/activate
pip install -r  requirements.txt
```

## OpenAI-compatible API

Token Factory provides OpenAI-compatible Chat Completions and Responses APIs.

Example code: [api_native.ipynb](api_native.ipynb)

Stateless Responses API example: [responses/README.md](responses/README.md)

[API reference](https://tokenfactory.nebius.com/api-reference)

## Third-party APIs

Nebius Token Factory also supports [third-party integrations](https://docs.tokenfactory.nebius.com/integrations/overview). Here are some examples.

## AISuite

[aisuite](https://github.com/andrewyng/aisuite) is a simple, unified interface to multiple Generative AI providers.

Example code: [api_aisuite.ipynb](api_aisuite.ipynb)

## LiteLLM

[LiteLLM](https://docs.litellm.ai/) is a popular API that provides consistent API for calling multiple providers.

Example code: [api_litellm.ipynb](api_litellm.ipynb)


## Llama-Index

[llama-index](https://docs.llamaindex.ai/en/stable/) is a library for building LLM / AI applications.

Example code: [api_llamaindex.ipynb](api_llamaindex.ipynb)

## More third-party APIs

See the [Token Factory integrations overview](https://docs.tokenfactory.nebius.com/integrations/overview) for the complete list.



