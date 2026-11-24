# Agent instructions: Factory Droid with Nebius Token Factory

For a coding agent asked to set this recipe up. [README.md](README.md) is the
version for people.

**Done means:** `python3 scripts/smoke_test.py` prints `ok` for every model the
user chose.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file. You only append to it, as shown below.
  Loading it with `. ./.env`, as step 10 does, is fine.
- Take model IDs only from `scripts/list_models.py`, run now. Never from
  memory, [RESULTS.md](RESULTS.md) or another document; retired IDs fail.
- Change `~/.factory/settings.json` only through `scripts/make_settings.py`.
  Droid keeps its own session logs and cache under `~/.factory` whenever it
  runs; that is expected.
- Steps marked **Ask the user** need an answer before you go on. Do everything
  else without asking.

## Steps

1. Check the tools.

   ```bash
   droid --version && python3 --version
   ```

   Python must be 3.10 or newer. If `droid` is missing, **ask the user** before
   installing it; the installer is at
   <https://docs.factory.com/droid-cli/quickstart>.

2. Create `.env` unless it exists.

   ```bash
   [ -f .env ] || cp env.example .env
   ```

3. **Ask the user** to open `.env`, paste their Token Factory key after
   `NEBIUS_API_KEY=`, save, and tell you when it is done. Keys are created at
   <https://tokenfactory.nebius.com>.

4. List the live models.

   ```bash
   python3 scripts/list_models.py
   ```

   `NEBIUS_API_KEY is not set` or `HTTP 401` means the key is missing or wrong:
   go back to step 3. The script's closing hint to edit `.env` is for people;
   you use step 6.

5. Drop the models that are being retired. Fetch
   <https://docs.tokenfactory.nebius.com/llms.txt>, open every page it lists
   with "deprecation" in the title, and remove each model ID those pages name
   from the list.

   Then **ask the user** which of the remaining models to set up. Show them
   the list, tell them Token Factory bills every prompt Droid sends, and
   repeat the exact IDs back before you go on.

6. Save the choice without opening `.env`. The last `TF_MODELS` line wins, so
   append again to change it.

   ```bash
   printf '\nTF_MODELS=%s\n' '<id-1>,<id-2>' >> .env
   ```

7. **Ask the user** whether you may add the models to
   `~/.factory/settings.json`, which is outside this folder. A backup is saved
   as `settings.json.bak` and their other settings are kept.

   ```bash
   python3 scripts/make_settings.py --install
   ```

   If they say no, run the same command without `--install`. It still writes
   `droid_settings.json`, which the next steps need.

8. Run the offline tests. They are free and need no key.

   ```bash
   python3 -m unittest discover -s tests
   ```

9. **Ask the user** whether you may spend a few paid requests per model. On a
   yes, run the smoke test. On a no, skip to the hand-back and say it was not
   run. The test has Droid fix a failing test in a temporary folder, deletes
   the folder, and exits 0 only if every model passes. `droid exec` needs no
   Factory sign-in.

   ```bash
   python3 scripts/smoke_test.py
   ```

10. Check Droid the way the user will run it. Loading `.env` this way prints
    nothing. If step 7 ran without `--install`, add
    `--settings droid_settings.json` after `exec`.

    ```bash
    set -a; . ./.env; set +a; droid exec -m <model-id> "Reply with the word ready."
    ```

## If the smoke test fails

Fix, rerun step 7's command, then retest only that model with
`python3 scripts/smoke_test.py <model-id>`.

| Output | What to do |
| --- | --- |
| `400 ... missing its reasoning` | Run `droid exec -m x "hi"` to list Droid's built-in model IDs. If one is the same model, append `TF_BASE_MODEL_IDS=<model-id>=<built-in-id>` to `.env`. If none is, append `TF_ALLOW_MISSING_THINKING=<model-id>`. |
| `arguments were not a valid JSON object`, or `FAIL` with no error | Rerun once with `--runs 3`. If it still fails, tell the user and suggest another model. Do not keep retrying. |
| `404` or `403` | The model was retired or the key cannot use it. Go back to step 4. |
| `` `droid` is not on PATH `` | Go back to step 1. |

## Hand back to the user

Tell them:

- Which models are set up and each one's smoke-test result.
- Droid reads the key from the terminal's environment, not from `.env`. They
  run `set -a; source .env; set +a` in each new terminal, or export
  `NEBIUS_API_KEY` in their shell profile. Offer to add it; do not edit the
  profile unasked.
- After `--install`: for interactive use they run `droid`, sign in to Factory
  in the browser (you cannot do this for them), run `/model` and pick a
  **Nebius ...** entry under **Custom Models**. To undo, they delete the
  entries whose `baseUrl` is the Token Factory URL from
  `~/.factory/settings.json`.
- Without `--install`: the models work only from this folder, as
  `droid exec --settings droid_settings.json -m <model-id> "<prompt>"`, and do
  not appear under `/model`. Offer to run step 7 with `--install` later.
- In both cases, deleting `droid_settings.json` and `.env` here removes the
  rest.
