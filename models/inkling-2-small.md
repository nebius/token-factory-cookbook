[Cookbook](../README.md) / [Model guides](README.md) / Inkling 2 Small

# How to use Inkling 2 Small

Call Thinking Machines Lab's Inkling 2 Small through the OpenAI-compatible API on Nebius Token Factory. This quickstart makes one finance reasoning request, streams an answer, and sends the model an image.

- **Model ID:** `thinkingmachines/Inkling-2-Small`
- **API base URL:** `https://api.tokenfactory.nebius.com/v1/`
- [Open Inkling 2 Small on Token Factory](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=thinkingmachines/Inkling-2-Small) · [Try it in the playground](https://tokenfactory.nebius.com/playground?models=thinkingmachines/Inkling-2-Small)
- [Python script](inkling-2-small.py) · [Notebook](inkling-2-small.ipynb) · [Open in Colab](https://colab.research.google.com/github/nebius/token-factory-cookbook/blob/main/models/inkling-2-small.ipynb)

## Model details

From the Token Factory model listing (`GET /v1/models?verbose=true`) on 13 November 2026:

| | |
| --- | --- |
| Context window | 1,048,576 tokens |
| Input and output | Text and images in, text out |
| Supported features | Tools, JSON mode, structured outputs, reasoning |
| Price per 1M tokens | $0.30 input, $0.06 cached input, $1.00 output |

Check the [model details](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=thinkingmachines/Inkling-2-Small) for current availability, limits and prices.

Inkling 2 Small is a 594B-parameter mixture-of-experts model with 17B active parameters, released with open weights under Apache 2.0. Thinking Machines describe it as "especially strong in finance and quantitative reasoning over spreadsheets, filings and documents", and as using "vision in the loop to interpret and validate the visual coding output it generates". Selected scores from their [model card](https://thinkingmachines.ai/model-card/inkling-2-small/), run at effort 0.99 and temperature 1.0:

| Area | Benchmark | Inkling 2 Small |
| --- | --- | ---: |
| Finance | Finance Agent v2.1 | 67.5% |
| Finance | Excel Modeling v1.1 | 69.5% |
| Documents | OmniDocBench v1.6 | 94.6% |
| Charts | Chartography (with Python) | 36.7% (82.1%) |
| Vision | ScreenSpot Pro (with Python) | 83.8% (92.0%) |
| Visual coding | DesignArena Web Apps | 1286 |
| Tools | MCP Atlas | 85.4% |
| Long context | LongBench v2 | 70.6% |

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

Save the following as `inkling-2-small.py`, or use the [included script](inkling-2-small.py):

```python
import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["NEBIUS_API_KEY"],
    base_url="https://api.tokenfactory.nebius.com/v1/",
)

response = client.chat.completions.create(
    model="thinkingmachines/Inkling-2-Small",
    messages=[{
        "role": "user",
        "content": (
            "Revenue grew from $120M to $150M while operating margin fell from 18% to 15%. "
            "Did operating income rise or fall, and by how much? Show the arithmetic."
        ),
    }],
)

print(response.choices[0].message.content)
```

Run it:

```bash
python inkling-2-small.py
```

The response should work out operating income as $21.6M before and $22.5M after, a rise of $0.9M. The wording varies between runs.

If you cloned this repository and use [uv](https://docs.astral.sh/uv/), run this from the repository root instead. The script declares its own dependencies:

```bash
uv run models/inkling-2-small.py
```

Inkling 2 Small reasons before it answers, and `response.usage.completion_tokens_details.reasoning_tokens` reports how many tokens that took. For long outputs, such as a full HTML page or a large table, set `max_tokens` with room for the reasoning as well as the answer.

## 3. Stream the answer

To display answer text as it arrives, replace the request and final `print` above with:

```python
stream = client.chat.completions.create(
    model="thinkingmachines/Inkling-2-Small",
    messages=[{"role": "user", "content": "Explain gross margin and operating margin in three bullet points."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices:
        text = chunk.choices[0].delta.content
        if text:
            print(text, end="", flush=True)
print()
```

## 4. Send an image

Inkling 2 Small reads images. To ask about a local chart, table or screenshot, send it as a base64 data URL:

```python
import base64

with open("chart.png", "rb") as f:
    image = base64.b64encode(f.read()).decode()

response = client.chat.completions.create(
    model="thinkingmachines/Inkling-2-Small",
    messages=[{
        "role": "user",
        "content": [
            {"type": "text", "text": "What does this image show? List any numbers you can read."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image}"}},
        ],
    }],
)

print(response.choices[0].message.content)
```

Replace `chart.png` with your own file, and the `image/png` type with `image/jpeg` for a JPEG.

## Next steps

- Build a sourced spreadsheet from a report: [Footnote](../apps/footnote/) has Inkling 2 Small read a PDF, write a model where every number cites its page, and check the report's claims, while the app verifies each number and formula without the model.
- See the [API examples](../api/README.md) for more SDK integrations.
- Read Thinking Machines' [announcement](https://thinkingmachines.ai/news/inkling-2-small/) and [model card](https://thinkingmachines.ai/model-card/inkling-2-small/) for model background, or download the [weights on Hugging Face](https://huggingface.co/thinkingmachines/Inkling-2-Small).

## Validation and troubleshooting

The script and notebook were checked offline with the OpenAI SDK and simulated API responses, and run live against Token Factory on 13 November 2026, together with the streaming and image examples above. The notebook is shared without recorded output.

If a request fails, check the API key and project access, then confirm the exact model ID in your project's `/v1/models` response. Check the [model details](https://tokenfactory.nebius.com/?modals=endpoint-details&model-id=thinkingmachines/Inkling-2-Small) for current availability, input support, context limits and prices.

The examples use default sampling settings. The script creates no cloud resources; remove the key from your shell with `unset NEBIUS_API_KEY` when finished.
