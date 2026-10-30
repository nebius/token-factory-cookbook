[Cookbook](../README.md) / [Start here](README.md) / Environment setup

# Set up your environment

Each recipe has its own dependencies. Set up the recipe you want to run rather than installing every project in the repository.

## Clone the cookbook

```bash
git clone https://github.com/nebius/token-factory-cookbook.git
cd token-factory-cookbook
```

## Create an API key

Sign in to [Nebius Token Factory](https://tokenfactory.nebius.com/) and create an API key in the console. Store it securely and use the [model catalog](https://tokenfactory.nebius.com/models) to choose a model available to your account.

For the root quickstart:

```bash
cp env_sample.txt .env
```

Edit `.env` with your own values:

```dotenv
NEBIUS_API_KEY=replace-with-your-api-key
NEBIUS_MODEL=replace-with-a-text-model-id
```

The `.env` file is ignored by Git. A recipe may provide its own `env.example` or `.env.example`; follow that README and copy the template into that recipe's directory. Do not put a server API key in browser code.

## Python recipes

Use the Python version required by the recipe. [uv](https://docs.astral.sh/uv/) handles virtual environments and dependency installation.

If the recipe has `pyproject.toml` and `uv.lock`:

```bash
# Run inside the recipe directory.
uv sync --frozen
uv run python example.py
```

Replace `example.py` with the entry point named in that recipe's README. For a recipe with `requirements.txt`:

```bash
uv venv --python 3.12
source .venv/bin/activate
uv pip install -r requirements.txt
```

You can also use Python's built-in environment support:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

For notebooks, install Jupyter in the same environment if the recipe does not already include it:

```bash
uv pip install jupyterlab ipykernel
python -m jupyter lab
```

Select that environment as the notebook kernel in your editor. For Google Colab, add `NEBIUS_API_KEY` under **Secrets** and enable notebook access. Do not paste keys into notebook cells.

## JavaScript and TypeScript applications

Use the Node.js version and package manager specified by the application. Install and run from its own directory:

```bash
# Use npm when the application has package-lock.json.
npm ci

# Use pnpm when the application has pnpm-lock.yaml.
pnpm install --frozen-lockfile
```

Then follow the application's run command and environment instructions. Some examples require additional service keys, Docker, or a Kubernetes cluster.

## Check your setup

Run the [first API call](../README.md#start-building), then choose an [agent](../agents/README.md), [application](../apps/README.md), or [workshop](../workshops/README.md). If a request fails, verify your key, model ID, and base URL against the [official documentation](https://docs.tokenfactory.nebius.com/).
