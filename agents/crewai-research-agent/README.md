# CrewAI with Nebius Token Factory

This example enriches the existing CrewAI integration with a runnable two-agent crew and a deterministic local tool. It uses CrewAI's built-in custom OpenAI-compatible route, so it does **not** add or require a Nebius provider class.

The recipe calls the supported OpenAI-compatible **Chat Completions** interface at `https://api.tokenfactory.nebius.com/v1`. It does not use or claim stateful Responses API behavior.

## What it demonstrates

- explicit Token Factory base URL and `NEBIUS_API_KEY` authentication;
- a current Token Factory model ID passed unchanged to the API;
- CrewAI's native `custom_openai=True` route rather than a duplicated provider;
- two sequential agents sharing one configured LLM;
- a deterministic local lookup tool and an evidence-bounded final task; and
- offline tests for configuration, tool behavior, crew wiring, and the outgoing Chat Completions request.

## Run it

Python 3.11 or newer and a [Token Factory API key](https://tokenfactory.nebius.com/project/api-keys) are required.

```bash
cd agents/crewai-research-agent
cp env.example .env
# Edit .env and set NEBIUS_API_KEY.
uv sync
uv run python agent.py
```

The default topic is `tool-using agents`. Change the `topic` input in `main()` to try another subject. The example tool deliberately uses a small local evidence map so its behavior is easy to inspect and test; replace it with your own validated data source for production use.

## Why `custom_openai=True`?

CrewAI already supports arbitrary OpenAI-compatible Chat Completions endpoints:

```python
llm = LLM(
    model="Qwen/Qwen3-30B-A3B-Instruct-2507",
    custom_openai=True,
    base_url="https://api.tokenfactory.nebius.com/v1",
    api_key=os.environ["NEBIUS_API_KEY"],
)
```

This keeps the provider-owned model ID intact and forces CrewAI's existing native OpenAI client to the Token Factory endpoint. There is no need for another CrewAI provider or adapter.

CrewAI also exposes a LiteLLM-based `nebius/...` shortcut. Use that shortcut only with a LiteLLM release containing [LiteLLM PR #36777](https://github.com/BerriAI/litellm/pull/36777), which repairs the Nebius default endpoint and catalog. The explicit `custom_openai=True` configuration above is independent of that release and is the path tested here.

## Test offline

```bash
uv run pytest -q
```

The tests install a mocked OpenAI transport and make no network calls. They assert that CrewAI sends bearer-authenticated `POST /v1/chat/completions` requests with the raw Token Factory model ID.

## References

- [CrewAI OpenAI-compatible endpoint documentation](https://docs.crewai.com/en/concepts/llms#openai)
- [Token Factory inference quickstart](https://docs.tokenfactory.nebius.com/inference/quickstart)
- [Token Factory model catalog](https://tokenfactory.nebius.com/)
