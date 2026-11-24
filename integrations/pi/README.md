# pi coding agent with Nebius Token Factory

Run [pi](https://pi.dev), the open-source terminal coding agent, on open models
from [Nebius Token Factory](https://tokenfactory.nebius.com). pi has no built-in
Nebius provider, so this recipe writes one into pi's `models.json` from the
live Token Factory catalog. No model ID is hardcoded.

Tested on 2026-11-24 with pi 1.6.0 on macOS. Per-model results are in
[RESULTS.md](RESULTS.md).

Setting this up with a coding agent? Point it at [AGENTS.md](AGENTS.md).

## Requirements

- pi (`pi --version`). Tested with 1.6.0. Install: `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.
- Python 3.10 or newer. There are no packages to install.
- A Token Factory API key. See [Getting started](../../start-here/setup.md).

Every prompt is a paid Token Factory request.

## Setup

Run everything from this folder.

1. Create `.env` and put your key in `NEBIUS_API_KEY`.

   ```bash
   cp env.example .env
   ```

2. See the live models that support tool calling.

   ```bash
   python3 scripts/make_models.py --list
   ```

   Skip any model with a
   [deprecation notice](https://docs.tokenfactory.nebius.com/llms.txt). To give
   pi only some models, put their IDs in `TF_MODELS` in `.env`, comma
   separated. Left empty, pi gets all of them.

3. Add the models to pi.

   ```bash
   python3 scripts/make_models.py --install
   ```

   This writes `models.json` here and merges a `nebius-token-factory` provider
   into `~/.pi/agent/models.json`, keeping your other providers. If that file
   already exists, the old one is saved as `models.json.bak`. Without `--install`, only the file here is
   written. Run it again whenever the Token Factory catalog changes.

The provider entry looks like this. The key is referred to by name, never
written:

```json
{
  "name": "Nebius Token Factory",
  "baseUrl": "https://api.tokenfactory.nebius.com/v1",
  "apiKey": "$NEBIUS_API_KEY",
  "api": "openai-completions",
  "compat": { "supportsDeveloperRole": false, "maxTokensField": "max_tokens" },
  "models": [{ "id": "<a live Token Factory model ID>", "...": "..." }]
}
```

Each model carries its context window, thinking and image support, and its
input, cached-input and output prices from the catalog, so pi's cost display is
right.

## Run

pi reads the key from the terminal's environment, not from `.env`. Load it in
each terminal, or export `NEBIUS_API_KEY` in your shell profile.

```bash
set -a; source .env; set +a
```

Then, from the project you want to work on:

```bash
pi --provider nebius-token-factory --model <model-id>
```

Inside pi, `/model` opens the model selector. For a one-off answer, add
`-p "<prompt>"`. In a script, also add `< /dev/null`: when its input is a
pipe that never closes, pi waits for it and does not start.

## Validate

Offline, with no key and no pi:

```bash
python3 -m unittest discover -s tests
```

Live, a few paid requests per model:

```bash
python3 scripts/smoke_test.py <model-id>
```

pi gets a throwaway Python project with one failing test. The script then runs
the tests itself and prints `ok` only if they pass and the test file is
unchanged. It uses its own settings folder (`.pi-agent` here), so it does not
read or change your pi configuration. `--runs 3` repeats each model.

## A package instead of a script

If you would rather have pi fetch the model list by itself on every start, the
community package [`tokenfactory-pi`](https://github.com/mosquito/tokenfactory-pi)
does that: `pi install npm:tokenfactory-pi`. It registers a provider named
`nebius`. It passed the same test on three models on 2026-11-24. It is not
maintained in this cookbook, and it counts cached input as free in pi's cost
display.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `404 ... does not exist` | The model was retired. Run `make_models.py --install` again and pick a current ID. |
| `Unknown provider "nebius-token-factory"` | Run `make_models.py --install`. Without `--install`, pi does not see the file. |
| `No API key found` or a `401` | Load `.env` in that terminal as shown under [Run](#run). |
| pi prints nothing and never returns in a script | Close its input: add `< /dev/null`. |
| A script reports success after a failed request | pi exits 0 even when the API rejects a request. Use `--mode json` and read `errorMessage`, as `smoke_test.py` does. |
| A model is missing from the list | It does not advertise tool calling, or your key cannot use it. |

To remove everything, delete the `nebius-token-factory` entry from
`~/.pi/agent/models.json`, and delete `models.json`, `.pi-agent` and `.env`
here.

## Source and license

Written for this cookbook. pi is a project of
[Earendil](https://github.com/earendil-works/pi). Its model configuration is
documented at
[Models](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md).
