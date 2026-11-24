# Agent instructions: Python AI agent with Beam

For a coding agent asked to set this recipe up. [README.md](README.md) is the
version for people.

**Done means:** `uv run python agent.py --seed 7` prints
`Graded: 3 of 3 correct`.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file. Loading it with `. ./.env`, as the steps
  do, is fine.
- The model and endpoint come from `NEBIUS_MODEL` and `NEBIUS_BASE_URL` in
  `.env`. Leave them as the template sets them.
- Do not run `sweep.py` unless the user asks. The full sweep in the README
  costs about $0.30.
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
   cannot use it, and the recipe is written for this model. An error that
   mentions `401` means the key is wrong: go back to step 4. Show any other
   error to the user and stop.

6. **Ask the user** whether you may make one paid run. It costs less than one
   cent. On a yes, run it. On a no, skip to the hand-back and say the paid
   run was not made.

   ```bash
   set -a; . ./.env; set +a
   uv run python agent.py --seed 7
   ```

   A working run ends like this, with its own numbers and a one-line summary
   from the model after them. A failed script in the `Graded` line is normal;
   the model retried it.

   ```text
   Q1: Asia Pacific (right)
   Q2: -32.6 (right)
   Q3: 2.8 (right)
   Graded: 3 of 3 correct in 9 turns | 8 tool calls | 1 failed scripts
   Tokens: 12,864 prompt | 1,278 completion (417 reasoning)
   Cost: $0.0045 at list price | 5.8 s
   ```

## If it fails

| Output | What to do |
| --- | --- |
| `401` | The key is missing or wrong. Go back to step 4. |
| `404` or model not found | Stop and tell the user: the model has been retired or the key cannot use it. |
| `ModuleNotFoundError: pandas` in a tool result | Run `uv sync` and start the agent with `uv run`. |
| A question marked `wrong` | Rerun once with `--show-reasoning`. If it is wrong again, show the user the output. Do not keep retrying. |
| `Graded: ... in 16 turns` | The run hit the turn cap. Rerun with `--max-turns 24`. |

## Hand back to the user

Tell them:

- The result of the offline tests and of the paid run, with its cost line.
- To run it themselves: `set -a; . ./.env; set +a`, then
  `uv run python agent.py --seed 7 --show-reasoning`. Another `--seed` gives a
  different dataset.
- `sweep.py` compares reasoning efforts. The full sweep in the README costs
  about $0.30, and you have not run it.
- To remove everything: `rm -rf .venv .env`.
