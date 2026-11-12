# Running Codetrail yourself

[← Back to the README](../README.md)

All it needs is a [Nebius Token Factory](https://dub.sh/aistudio) API key. There's no vector database, embeddings model or indexing job to set up: the model's 1M-token context takes a whole repo in one prompt, so Codetrail is one app and one SQLite file.

## With Docker

[Docker](https://www.docker.com/products/docker-desktop) packages Codetrail with everything it needs (Node.js, its dependencies, the built app) into one image, so you don't install anything else. Build the image once, then run it whenever you want:

```bash
git clone https://github.com/Studio1-OSS/Codetrail.git
cd Codetrail
docker build -t codetrail .

docker run --name codetrail -p 3000:3000 \
  -e NEBIUS_API_KEY=your-key \
  -v codetrail-data:/data \
  -v ~/code:/repos:ro \
  codetrail
```

Then open **http://localhost:3000**. What each part does:

| Part | What it's for |
| --- | --- |
| `-p 3000:3000` | Opens the app at localhost:3000 |
| `-e NEBIUS_API_KEY=…` | Your key, used for the model calls. Add `-e GITHUB_TOKEN=…` for private GitHub repos and GitHub's higher rate limit |
| `-e NEBIUS_MODEL=…` | Optional. `moonshotai/Kimi-K3.1-Pro` runs on Kimi K3.1 Pro instead of the default, DeepSeek V4.1 Flash 1017 |
| `-v codetrail-data:/data` | A Docker volume that keeps the database (repos read, tours, answers, costs) when the container stops or you update it |
| `-v ~/code:/repos:ro` | Optional. Shares a folder of your projects, read-only. Each folder inside it appears under **Your folders** on the home page, uncommitted changes included |

New to Codetrail? The **[user guide](user-guide.md)** walks through every part of the app, from the first read to pull requests and MCP.

Stop it with `docker stop codetrail` and start it again with `docker start codetrail`. To update: `git pull`, `docker build -t codetrail .`, `docker rm codetrail`, then the same `docker run`. The volume keeps your data.

## From source

Use Node.js 22.13+ and pnpm:

```bash
git clone https://github.com/Studio1-OSS/Codetrail.git
cd Codetrail
pnpm install
cp .env.example .env      # add NEBIUS_API_KEY
pnpm dev                  # http://localhost:3000
```

Nobody signs in by default (`AUTH_MODE=none`) and there are no limits: no quotas, no rate limit, no spend cap unless you set `DAILY_BUDGET_USD`. The database migrates itself on first use. Set `GITHUB_TOKEN` to lift GitHub's own limit of 60 API requests an hour.

**Local folders.** Set `LOCAL_ROOT` to a folder (say `~/code`) and every folder inside it can be opened at `/_local/<folder>`, and is listed on the home page. They're read from disk with the same filters and secret scan as a GitHub repo. A folder's "commit" is a fingerprint of its files, so after you edit something, the next visit offers a fresh read, while an unchanged folder replays free. Local folders are never available when `AUTH_MODE=github`.

**Private repos.** Self-hosted, Codetrail opens any private repo your `GITHUB_TOKEN` can read (a fine-grained token with "Contents: read" on those repos is enough). Its files, maps, tours and docs stay in your own database; the only thing that leaves your machine is the model call to Nebius Token Factory. Token Factory's prompt cache keeps derived model state, not your code, and only a request that starts with exactly the same content can reuse it ([their caching docs](https://docs.tokenfactory.nebius.com/cached-tokens)). The hosted app (`AUTH_MODE=github`) stays public-only, because stored tours there are open to every visitor.

## Hosted mode (sign-in and free quotas)

Set `AUTH_MODE=github`, `BETTER_AUTH_SECRET` (any long random string), `BETTER_AUTH_URL` (your site's URL) and a GitHub OAuth app's `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` (callback: `<your site>/api/auth/callback/github`). Anyone can open stored repos, tours and answers. Reading a new repo or asking needs sign-in, with `QUOTA_READS_PER_DAY` and `QUOTA_ASKS_PER_DAY` per account; set `DAILY_BUDGET_USD` to cap total spend. For Vercel, point `DATABASE_URL` and `DATABASE_AUTH_TOKEN` at a Turso database.

## Coding agents (MCP)

Setup for Claude Code, Cursor and VS Code, and the six tools, are in the [user guide](user-guide.md#13-coding-agents-mcp).

## Scripts

```bash
pnpm test                                   # unit tests
pnpm tsx scripts/inspect.mts owner/repo     # what would be read and what it would cost, no AI call
pnpm eval owner/repo [...]                  # map + first tour per repo, with cost and checks (costs money)
pnpm smoke:nebius                           # model, context and price straight from Token Factory
pnpm tsx scripts/check-gating.mts           # hosted sign-in and quota checks, no AI call
pnpm a11y [owner/repo ...]                  # axe-core WCAG 2.2 AA scan of the main pages, both themes, no AI call
pnpm screenshots                            # retake the README screenshots in both themes, no AI call
pnpm demo:test                              # drive the demo flow in a browser and check it; replays stored work
```
