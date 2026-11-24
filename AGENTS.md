# Agent instructions: Nebius Token Factory cookbook

For a coding agent working in a clone of this repository. People start at
[README.md](README.md).

## Setting up a recipe for a user

1. Work in the recipe's own folder.
2. If the folder has an `AGENTS.md`, follow it. It was written and tested for
   agents, and it wins where it differs from the recipe's README.
3. If it has none, follow the recipe's `README.md` under the rules below, and
   tell the user the recipe has no agent instructions yet.

## Rules for every recipe

- **Keys.** The user types keys into `.env`, created from the recipe's
  environment template. Never ask for a key in chat. Never open, print or echo
  `.env`. Never put a key in a command, a URL or a tracked file. To add a
  setting yourself, append a line to `.env`. Loading the file into a command
  with `. ./.env` is fine.
- **Models.** Token Factory retires models and does not reroute retired IDs,
  so a model named in a recipe may be gone. Before the first paid run, check
  the ID against the live catalog. If it is missing, stop and tell the user;
  change the recipe's model only with their agreement.

  ```bash
  set -a; . ./.env; set +a
  curl -s https://api.tokenfactory.nebius.com/v1/models -H "Authorization: Bearer $NEBIUS_API_KEY" \
    | python3 -c 'import json,sys; print("\n".join(sorted(m["id"] for m in json.load(sys.stdin)["data"])))'
  ```

- **Ask the user first** before you:
  - make paid requests (say roughly how many or what they cost);
  - install system software such as Python, Node.js, uv or Docker;
  - change anything outside the recipe folder, such as files in their home
    folder, shell profiles or global packages;
  - create accounts or cloud resources.
- **Things only the user can do.** Creating keys and signing in to services.
  Say exactly what you need and wait.
- **Do everything else without asking:** installing the recipe's own
  dependencies inside its folder, creating `.env` from the template, running
  free offline tests.
- **Finish with proof.** Run the recipe's own check and report what ran, what
  did not, what the user still has to do, and how to remove what you created.
- Do not commit, push or open pull requests unless the user asks.

## Adding or changing a recipe

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and the
[recipe README template](.github/RECIPE_TEMPLATE.md). Give every runnable
recipe an `AGENTS.md` from the
[agent instructions template](.github/AGENTS_TEMPLATE.md), and dry-run it
before you submit.

Never commit a key, a filled-in `.env`, dependency folders or build output.
Take model IDs from the live catalog, not from memory or older recipes.

From the repository root:

```bash
python3 .github/scripts/check_internal_links.py
python3 .github/scripts/check_api_contracts.py
python3 -m unittest test_recipe_secret_hygiene test_batch_notebook
python3 -m unittest discover -s api -p 'test_*.py'
git diff --check
```

Then run the recipe's own tests and build.
