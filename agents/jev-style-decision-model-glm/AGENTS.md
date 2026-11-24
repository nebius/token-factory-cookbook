# Agent instructions: Jev-style decision model with GLM

For a coding agent asked to set this recipe up. [README.md](README.md) is the
version for people.

**Done means:** `uv run python app.py` prints a `Requests:` line and a
`Decision:` line.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file. Loading it with `. ./.env`, as the steps
  do, is fine.
- The model and endpoint come from `NEBIUS_MODEL` and `NEBIUS_BASE_URL` in
  `.env`. Leave them as the template sets them.
- Do not run `evaluate.py` or `injection.py` unless the user asks. They send
  many more requests than `app.py`.
- Steps marked **Ask the user** need an answer before you go on. Do everything
  else without asking.

## Steps

1. Check the tools.

   ```bash
   uv --version
   ```

   `uv` installs the Python version the recipe pins and keeps its downloads
   in its own cache outside this folder; that is expected. If `uv` is
   missing, **ask the user** before installing it; see
   <https://docs.astral.sh/uv/>.

2. Install the dependencies and run the offline tests. They are free and need
   no key. Expect `8 passed`.

   ```bash
   uv sync && uv run python -m pytest -q -p no:cacheprovider
   ```

3. Create `.env` unless it exists.

   ```bash
   [ -f .env ] || cp env.example .env
   ```

4. **Ask the user** to open `.env`, paste their Token Factory key after
   `NEBIUS_API_KEY=`, save, and tell you when it is done. Keys are created at
   <https://tokenfactory.nebius.com>.

5. Check that the key works and the model is still served. This is free and
   prints `True` or `False`.

   ```bash
   set -a; . ./.env; set +a
   uv run python -c 'import os; from openai import OpenAI; c = OpenAI(base_url=os.environ["NEBIUS_BASE_URL"], api_key=os.environ["NEBIUS_API_KEY"]); print(os.environ["NEBIUS_MODEL"] in [m.id for m in c.models.list()])'
   ```

   On `False`, stop and tell the user: the model has been retired or the key
   cannot use it. An error that mentions `401` means the key is wrong: go back
   to step 4. Show any other error to the user and stop.

6. **Ask the user** whether you may make one paid run. It sends 7 small
   requests and costs well under one cent. On a yes, run it. On a no, skip
   to the hand-back and say the paid run was not made.

   ```bash
   set -a; . ./.env; set +a
   uv run python app.py
   ```

   A working run prints a JSON object with `team`, `urgent` and `frustration`,
   then two lines like these, with its own numbers:

   ```text
   Requests: 7, prompt tokens: 762, latency: 3.67s
   Decision: route to technical
   ```

## If it fails

| Output | What to do |
| --- | --- |
| `401` | The key is missing or wrong. Go back to step 4. |
| `404` or `model not found` | Stop and tell the user: the model has been retired or the key cannot use it. |
| The run takes 10 seconds or more | That is the service, not the setup. Nothing to fix. |

## Hand back to the user

Tell them:

- The result of the offline tests, and the `Requests:` and `Decision:` lines
  from the paid run.
- To run it themselves: `set -a; . ./.env; set +a`, then
  `uv run python app.py`, or `uv run python app.py "<a support ticket>"` to
  classify their own text.
- `evaluate.py` and `injection.py` reproduce the results in the README. You
  have not run them.
- To remove everything: `rm -rf .venv .env`.
