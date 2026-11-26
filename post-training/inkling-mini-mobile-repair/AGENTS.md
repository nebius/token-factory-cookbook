# Agent instructions for the mobile repair recipe

Run commands from this directory. For human instructions see [README.md](README.md).

1. Check for Bash, Python 3.12+ and a local Chromium-compatible browser. Ask before installing system software. Create a local replay environment with `python3 -m venv .venv-replay`, activate it and run `python -m pip install -r requirements-replay.txt`. If the browser is missing, set `PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers"`, export it, and run `python -m playwright install chromium`.
2. Run `bash replay.sh`. It needs no credentials or live model calls. Check `replay-results/scores.json` and open `replay-results/showcase.html`. The recorded base and tuned counts were 18 and 24 on the primary set and 3 and 8 on the second template. If Chromium cannot start, check for missing Linux shared libraries.
3. For a new run, follow the README's GPU and teacher steps in a fresh recipe copy. Ask before provisioning hardware, incurring GPU charges, or making the 237 paid teacher requests. Use a model from the current Token Factory catalog. Have the user enter their key in their local .env. Never print that file.
4. Report the actual checks, metrics, artifacts and any live steps skipped. After a paid run, have the owner stop the Devlab when finished and retain or remove the persistent data as needed.
