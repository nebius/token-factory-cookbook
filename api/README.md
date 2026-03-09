# Run Models on Nebius Token Factory using APIs

This guide shows how to run models using various python APIs.

## References and Acknowledgements

- [API documentation](https://docs.tokenfactory.nebius.com//inference/quickstart)

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

## OpenAI Compatible API

This is the default API. OpenAI API comptable.

Example code: [api_native.ipynb](api_native.ipynb)

[API reference](https://tokenfactory.nebius.com/api-reference)

## Thirdparty APIs 

Nebius Token Factory also supports [third party APIs](https://docs.tokenfactory.nebius.com//inference/integrations).  Here are some examples

## AISuite

[aisuite](https://github.com/andrewyng/aisuite) is a simple, unified interface to multiple Generative AI providers.

Example code: [api_native.ipynb](api_native.ipynb)

## LiteLLM

[LiteLLM](https://docs.litellm.ai/) is a popular API that provides consistent API for calling multiple providers.

Example code: [api_litellm.ipynb](api_litellm.ipynb)


## Llama-Index

[llama-index](https://docs.llamaindex.ai/en/stable/) is a library for building LLM / AI applications.

Example code: [api_llamaindex.ipynb](api_llamaindex.ipynb)

## More Thirdparty APIs

See [Nebius third party API documentation](https://docs.tokenfactory.nebius.com//inference/integrations) for complete list.




