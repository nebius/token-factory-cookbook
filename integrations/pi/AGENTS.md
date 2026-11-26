# Agent instructions: pi coding agent with Nebius Token Factory

For a coding agent asked to set this recipe up. [README.md](README.md) is the
version for people.

**Done means:** `python3 scripts/smoke_test.py <tested-id>` prints `ok` for
every model the user chose to test, or the user declined the paid test and you
said so.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file. You only append to it, as shown below.
  Loading it with `. ./.env`, as step 10 does, is fine.
- Take model IDs only from `python3 scripts/make_models.py --list`, run now.
  Never from memory or another document; retired IDs fail.
  [RESULTS.md](RESULTS.md) may only tell you which of the live models passed
  before.
- Change `~/.pi/agent/models.json` only through
  `scripts/make_models.py --install`.
- When you run `pi` with a prompt yourself, end the command with
  `< /dev/null`. Without it pi waits for input and never returns.
- Steps marked **Ask the user** need an answer before you go on. Do everything
  else without asking.

## Steps

1. Check the tools.

   ```bash
   pi --version && python3 --version
   ```

   Python must be 3.10 or newer; if it is older, stop and tell the user. If
   `pi` is missing, **ask the user** before installing it. It needs Node.js:
   `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`.

2. Create `.env` unless it exists.

   ```bash
   [ -f .env ] || cp env.example .env
   ```

3. **Ask the user** to open `.env`, paste their Token Factory key after
   `NEBIUS_API_KEY=`, save, and tell you when it is done. Give them the full
   path of the file; it is hidden in most file browsers. Keys are created at
   <https://tokenfactory.nebius.com>.

4. List the live models that support tool calling. This is free, and it
   always shows the whole live list, whatever `TF_MODELS` holds.

   ```bash
   python3 scripts/make_models.py --list
   ```

   `NEBIUS_API_KEY is not set` or `HTTP 401` means the key is missing or wrong:
   go back to step 3.

5. Drop the models that are being retired. Fetch
   <https://docs.tokenfactory.nebius.com/llms.txt> and open every page whose
   title contains "Deprecation", in any letter case. Each notice has a table:
   the first column, or the only one, is the model being retired; a second
   column is the recommended replacement. Drop every live model whose ID is
   exactly a first-column ID, ignoring letter case, even if another notice
   recommends it and even if its date has passed. A longer ID is a different
   model: a retired `org/Model` does not retire `org/Model-0813`. Do not drop
   a model only because it appears in a second column. If a page cannot be
   fetched, tell the user which one and ask whether to go on without it.

   Then show the user the remaining models and the ones you dropped, and
   **ask the user** which one or two to test. If they have no preference,
   suggest one or two that RESULTS.md shows passing. Tell them Token Factory
   bills every prompt pi sends. State the exact IDs you will test; that needs
   no second answer.

6. Save every remaining model without opening `.env`, not only the ones to
   test. The last `TF_MODELS` line wins, so append again to change it.

   ```bash
   printf '\nTF_MODELS=%s\n' '<remaining-id>,<remaining-id>,<remaining-id>' >> .env
   ```

7. Write `models.json` in this folder. This is free and changes nothing
   outside the folder.

   ```bash
   python3 scripts/make_models.py
   ```

8. Run the offline tests. They are free and need no key.

   ```bash
   python3 -m unittest discover -s tests
   ```

9. **Ask the user** whether you may spend a few paid requests per model. On a
   yes, run the smoke test on the models they chose. On a no, skip to step 10
   and say the test was not run. Each model takes 5 to 30 seconds. If the
   command has not returned after ten minutes, stop it and show the user what
   it printed.

   ```bash
   python3 scripts/smoke_test.py <tested-id> <tested-id>
   ```

   pi fixes a failing test in a temporary folder, which the script deletes.
   The script uses its own pi settings in `.pi-agent` here and does not read
   or change the user's. A working run prints one row per model, with its own
   numbers, and exits 0:

   ```text
   MODEL             RESULT  PASSED  SECONDS  TOOL CALLS
   <tested-id>       ok      1/1         4.9         4.0
   ```

10. **Ask the user** whether you may add the models to
    `~/.pi/agent/models.json`, which is outside this folder. Their other
    providers are kept, and if the file already exists the old one is saved
    as `models.json.bak`. On a no, skip to the hand-back.

    ```bash
    python3 scripts/make_models.py --install
    ```

    If they said yes in step 9, check pi the way they will run it, with the
    first model you tested. This is one small paid request and their yes
    covers it. It should print `ready`.

    ```bash
    set -a; . ./.env; set +a; pi --provider nebius-token-factory --model <tested-id> --no-session -p "Reply with the word ready." < /dev/null
    ```

## If it fails

| Output | What to do |
| --- | --- |
| `404` and `does not exist` | The model was retired since step 4. Go back to step 4. |
| `Not in models.json` | Run step 7 again, then retest. |
| `Not live, or without tool calling` | An ID in `TF_MODELS` is wrong. Append a corrected `TF_MODELS` line as in step 6. |
| `FAIL` with no error line | Rerun that model once with `--runs 3`. If it fails again, tell the user and suggest another model. Do not keep retrying. |
| `` `pi` is not on PATH `` | Go back to step 1. |
| `No API key found for nebius-token-factory` | The key is not loaded in that shell. Run the whole line from step 10 as one command. |
| `Unknown provider "nebius-token-factory"` | Step 10's `--install` did not run. pi cannot see the models without it. |

## Hand back to the user

Tell them:

- Which models pi now has, and each tested model's result.
- pi reads the key from the terminal's environment, not from `.env`. In each
  new terminal they run `set -a; source <full path to this folder>/.env; set +a`.
  Offer to add that same line to their shell profile so it happens by itself;
  do not edit the profile unasked, and never copy the key into it.
- After `--install`: they start pi in any project with
  `pi --provider nebius-token-factory --model <model-id>`, and `/model` inside
  pi opens the model selector. When Token Factory adds or retires models, they
  run `python3 scripts/make_models.py --install` here again.
- Without `--install`: pi does not see the models yet. Offer to run step 10
  later.
- To undo: delete the `nebius-token-factory` entry from
  `~/.pi/agent/models.json`, and delete `models.json`, `.pi-agent` and `.env`
  here. If a `models.json.bak` sits beside pi's file, it is the version from
  before the install.
