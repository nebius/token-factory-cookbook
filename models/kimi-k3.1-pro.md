[Cookbook](../README.md) / [Model guides](README.md) / Kimi K3.1 Pro

# How to use Kimi K3.1 Pro

Call Moonshot AI's Kimi K3.1 Pro through the OpenAI-compatible API on Nebius Token Factory. This quickstart makes one coding request and prints the answer.

- **Model ID:** `moonshotai/Kimi-K3.1-Pro`
- **API base URL:** `https://api.tokenfactory.nebius.com/v1/`
- [Open Kimi K3.1 Pro on Token Factory](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=moonshotai/Kimi-K3.1-Pro)
- [Python script](kimi-k3.1-pro.py) · [Notebook](kimi-k3.1-pro.ipynb) · [Open in Colab](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/models/kimi-k3.1-pro.ipynb)

## 1. Get your API key

Create an API key for your Token Factory project. You will need access to the model and a project with billing enabled. Inference requests use your project's balance.

Set the key in your terminal:

```bash
export NEBIUS_API_KEY="YOUR_TOKEN_FACTORY_API_KEY"
```

## 2. Make your first request

Use Python 3.12 or later. Install the OpenAI SDK in your Python environment:

```bash
python -m pip install 'openai>=2.48.0,<3'
```

Save the following as `kimi-k3.1-pro.py`, or use the [included script](kimi-k3.1-pro.py):

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NEBIUS_API_KEY"],
    base_url="https://api.tokenfactory.nebius.com/v1/",
)

response = client.chat.completions.create(
    model="moonshotai/Kimi-K3.1-Pro",
    messages=[{
        "role": "user",
        "content": "Write a Python function that retries a request up to three times with exponential backoff.",
    }],
)

print(response.choices[0].message.content)
```

Run it:

```bash
python kimi-k3.1-pro.py
```

The response should contain a Python retry function and an explanation. The exact answer can vary; review and test generated code before using it.

If you cloned this repository and use [uv](https://docs.astral.sh/uv/), run this from the repository root instead. The script declares its own dependencies:

```bash
uv run models/kimi-k3.1-pro.py
```

## 3. Stream the answer

To display answer text as it arrives, replace the request and final `print` above with:

```python
stream = client.chat.completions.create(
    model="moonshotai/Kimi-K3.1-Pro",
    messages=[{"role": "user", "content": "Explain exponential backoff in three bullet points."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices:
        text = chunk.choices[0].delta.content
        if text:
            print(text, end="", flush=True)
print()
```

## Next steps

- Send the model an image: the [chart agent example](kimi-k3.1-pro-chart-agent/README.md) reads a bar chart and records each bar through a declared tool.
- Read a whole paper with its figures: the [paper to interactive explainer app](../apps/paper-to-interactive-explainer/README.md) turns an arXiv paper into an interactive HTML lesson.
- Turn a sketch into CAD: the [napkin to 3D print app](../apps/napkin-to-3d-print/README.md) writes and self-reviews a parametric CadQuery model.
- Follow the [OpenCode setup guide](../coding/opencode.md#kimi-k31-pro) to use the model in a coding agent.
- See the [API examples](../api/README.md) for more SDK integrations.
- Read [Moonshot's technical overview](https://www.kimi.ai/blog/kimi-k3-1-pro) for model background.

## Validation and troubleshooting

The script and notebook have been checked offline with the OpenAI SDK and simulated API responses. A live K3.1 Pro request was not run for this contribution.

If a request fails, check the API key and project access, then confirm the exact model ID in your project's `/v1/models` response. Check the [model details](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=moonshotai/Kimi-K3.1-Pro) for current availability, input support, context limits and prices.

The examples use text inputs and default sampling settings. Kimi app tools, financial-data connectors and the Highspeed offering are separate from this API example. The script creates no cloud resources; remove the key from your shell with `unset NEBIUS_API_KEY` when finished.
