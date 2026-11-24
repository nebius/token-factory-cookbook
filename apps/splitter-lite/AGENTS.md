# Agent instructions: Splitter Lite

For a coding agent asked to set this recipe up. [README.md](README.md) is the
version for people.

**Done means:** `npm run check-samples` ends with
`4/4 splits match the answer keys to the cent`.

## Rules

- Run every command from this folder.
- Never open, print or echo `.env`, and never ask for the API key in chat. The
  user types the key into the file.
- `env.example` sets the model and endpoint the recipe was tested with. Do not
  add or change `NEBIUS_MODEL` or `NEBIUS_BASE_URL`.
- `next dev` writes the block at the end of this file, between the
  `nextjs-agent-rules` markers. Leave it in place.
- Steps marked **Ask the user** need an answer before you go on. Do everything
  else without asking.

## Steps

1. Check the tools.

   ```bash
   node --version && npm --version
   ```

   Node.js must be 22.13 or newer. If it is missing or older, **ask the user**
   before installing or upgrading it.

2. Install the dependencies and run the unit tests. They are free and need no
   key. Expect every test to pass. npm may also print audit or install-script
   warnings; leave them, and do not run `npm audit fix`.

   ```bash
   npm install && npm test
   ```

3. Create `.env` unless it exists.

   ```bash
   [ -f .env ] || cp env.example .env
   ```

4. **Ask the user** to open `.env`, paste their Token Factory key after
   `NEBIUS_API_KEY=`, save, and tell you when it is done. Keys are created at
   <https://tokenfactory.nebius.com>.

5. **Ask the user** whether you may run the sample bills against their answer
   keys. It makes real requests and costs about $0.02. On a yes, run it. On
   a no, skip to the hand-back and say the paid check was not made.

   ```bash
   npm run check-samples
   ```

   A working run prints four lines that start with `✓` and ends like this,
   with its own cost:

   ```text
   4/4 splits match the answer keys to the cent · total cost $0.0189
   ```

6. **Ask the user** whether they want the web app started. It runs until
   stopped, so start it as a background process that outlives the command,
   using your own tool for long-running commands.

   ```bash
   npm run dev
   ```

   It is up when this prints `200`; retry for up to 30 seconds. If it never
   does, read the server's output and see the table below. Give the user the
   address, <http://localhost:3100>, and stop the process when they are
   finished.

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3100
   ```

## If it fails

| Output | What to do |
| --- | --- |
| `Set NEBIUS_API_KEY in .env first` | The key is not saved in `.env`. Go back to step 4. |
| `401` | The key is wrong. Go back to step 4. |
| `404` or model not found | The model in `.env` has been retired or the key cannot use it on that endpoint. Stop and tell the user. |
| A line that starts with `✗` | Rerun once; reading a bill varies a little between runs. If it fails again, show the user that line with its `model:` and `answer:` lines. |
| `npm run dev` reports that port 3100 is in use | Something else is on that port. **Ask the user** before stopping it. |

## Hand back to the user

Tell them:

- The test result and the `check-samples` summary line with its cost.
- Whether the web app is running, at <http://localhost:3100>. To start it
  themselves they run `npm run dev` and stop it with Ctrl+C.
- To split a bill from the terminal:
  `npm run agent -- samples/groceries-21.png "Sophie had the Coffee beans 500g, Lukas had the Dish soap, everything else shared" Lukas,Sophie`.
- This is a local demo with no accounts. They should not expose it publicly
  with their own key.
- To remove everything: `rm -rf node_modules .next next-env.d.ts .env`.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
