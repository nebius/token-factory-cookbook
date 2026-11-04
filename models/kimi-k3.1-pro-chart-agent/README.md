[Cookbook](../../README.md) / [Model guides](../README.md) / Kimi K3.1 Pro chart agent

# Read a chart with Kimi K3.1 Pro and record it through a tool

Kimi K3.1 Pro accepts images. This example sends it a bar chart, declares one tool, `record_metric`,
and runs the tool-call loop until the model has recorded every bar and summarised the chart.
The full walkthrough, including the request settings that matter for an always-thinking model, is on
[dev.nebius.com](https://dev.nebius.com/cookbook/kimi-k3-1-pro-token-factory).

## Run it

Python 3.10 or newer is required (`app.py` uses `str | None`).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
export NEBIUS_API_KEY="your-key"
.venv/bin/python app.py
```

With uv instead: `uv venv --python 3.12 .venv && uv pip install -r requirements.txt`.

Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NEBIUS_API_KEY` | required | Token Factory API key |
| `NEBIUS_BASE_URL` | `https://api.tokenfactory.nebius.com/v1` | API base URL |
| `NEBIUS_MODEL` | `moonshotai/Kimi-K3.1-Pro` | Model ID |
| `KIMI_REASONING_EFFORT` | unset (model default) | `low`, `medium`, `high`, `max` or `none` |
| `CHART_IMAGE` | `chart.png` next to the script | Local PNG path or a public image URL |

Expected output:

```
recorded Jan: 12 thousands
recorded Feb: 15 thousands
recorded Mar: 21 thousands
recorded Apr: 18 thousands
recorded May: 26 thousands
recorded Jun: 24 thousands
Kimi response: May has the largest bar at 26 thousand, while Jan has the smallest at 12 thousand.
usage: prompt=2635 completion=576 reasoning=158 metrics=6
```

Wording varies between runs. The six recorded values and the `metrics=6` count are the check.

## Tests

`.venv/bin/python -m pytest -q` runs the loop against a fake client. No network, no key needed.

## Troubleshooting

- `404` model not found: the ID is `moonshotai/Kimi-K3.1-Pro`, case matters.
- `429` tokens quota: request more quota for the model on the Token Factory console.
- Empty answer with `finish_reason: length`: raise `max_tokens`; reasoning tokens count against it.
- `422` on an image URL: the host refused Token Factory's fetcher. Download the file and pass a local path.

The script creates no cloud resources. `unset NEBIUS_API_KEY` and delete `.venv` when done.
