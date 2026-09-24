# Deep PR Reviewer

A self-hosted GitHub pull-request reviewer built with [LangChain Deep Agents](https://docs.langchain.com/oss/python/deepagents/overview) and [Nebius Token Factory](https://docs.tokenfactory.nebius.com/api-reference/introduction).

It receives GitHub webhooks, fetches changed-file patches, asks a Deep Agents supervisor to use focused correctness and security subagents, validates every resulting finding against an added diff line, and posts a CodeRabbit-style walkthrough plus inline review comments. It intentionally reports only specific, evidence-backed defects—not style nits or generic advice.

## Features

- Verifies GitHub webhook signatures with `X-Hub-Signature-256`.
- Reviews opened, reopened, synchronized, and ready-for-review PRs; drafts are opt-in.
- Uses a GitHub App installation token (recommended), or a fine-grained GitHub token.
- Uses Nebius's OpenAI-compatible endpoint through `langchain-openai`.
- Uses Deep Agents supervisor/subagent delegation for correctness and security review.
- Limits model input and finding count, then validates paths, right-side added lines, and duplicates before GitHub is called.
- Exposes `GET /health` for Railway.

The model has no GitHub write tool. Review submission happens only after deterministic validation.

## Local development

```bash
cp .env.example .env
# Fill in .env
python -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
uvicorn app.main:app --reload
```

```bash
ruff check .
pytest
```

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_WEBHOOK_SECRET` | Yes | Random value configured identically in the GitHub App webhook. |
| `NEBIUS_API_KEY` | Yes | Nebius Token Factory API key. |
| `GITHUB_APP_ID` | Recommended | GitHub App ID; must be paired with `GITHUB_APP_PRIVATE_KEY`. |
| `GITHUB_APP_PRIVATE_KEY` | Recommended | PEM private key generated for the GitHub App. |
| `GITHUB_TOKEN` | Alternative | Fine-grained token when no App credentials are configured. |
| `NEBIUS_MODEL` | No | Token Factory model supporting tool calling; default `moonshotai/Kimi-K2.5`. |
| `NEBIUS_BASE_URL` | No | Default `https://api.tokenfactory.nebius.com/v1/`. |
| `REVIEW_DRAFTS` | No | Set `true` to review drafts; default `false`. |
| `MAX_FILES` | No | Files fetched per PR (1–100); default `40`. |
| `MAX_PATCH_CHARS` | No | Patch characters sent to the agent (5,000–500,000); default `120000`. |
| `MAX_FINDINGS` | No | Maximum inline findings (1–20); default `8`. |
| `LOG_LEVEL` | No | Default `INFO`. |

For a GitHub App, use **Pull requests: Read & write**, **Contents: Read-only**, and **Metadata: Read-only** repository permissions. Subscribe to the **Pull request** webhook event and install only on repositories this service should review. For a fine-grained token, grant the same repository-level permissions.

## Railway deployment

1. Push this repository to GitHub, then create a Railway project from that repository. The included `Dockerfile` and `railway.toml` are detected automatically.
2. In the service's **Variables** tab, add `GITHUB_WEBHOOK_SECRET`, `NEBIUS_API_KEY`, `GITHUB_APP_ID`, and `GITHUB_APP_PRIVATE_KEY`. Paste the full PEM private key, including its `BEGIN` and `END` lines. As an alternative, set `GITHUB_TOKEN` and leave both App variables empty.
3. Optionally set `NEBIUS_MODEL` to a tool-calling model enabled in the Token Factory project. Nebius exposes the configured model through its OpenAI-compatible `/v1/` API.
4. Deploy the service. In Railway **Settings → Networking**, generate a public domain and open `https://YOUR-DOMAIN/health`; it should return `{"status":"ok"}`.
5. In GitHub **Settings → Developer settings → GitHub Apps**, create a GitHub App. Set its webhook URL to `https://YOUR-DOMAIN/webhooks/github`, use the same webhook secret, assign the permissions/events above, create the App, and generate a private key.
6. Install the App on the target repository or organization. Open or update a non-draft PR. Railway logs will show the review result and GitHub will receive one inline review.

Use GitHub's **Redeliver** control on the App's `ping` webhook to check connectivity; the service responds with `202 {"status":"pong"}`.

## Architecture

```text
GitHub pull_request webhook
  -> signature verification and event filter
  -> GitHub API fetches PR metadata and patches
  -> Deep Agents supervisor
       -> correctness reviewer subagent
       -> security reviewer subagent
  -> JSON parsing, added-line validation, deduplication
  -> collapsible walkthrough with changed-file summary, effort estimate, and poem
  -> GitHub review with CodeRabbit-style inline comments
```

## Operational notes

- The delivery cache is in memory, so it blocks immediate duplicates on one Railway instance. Use a durable queue/idempotency store before horizontally scaling.
- GitHub can omit patches for binary or very large files. Those files cannot receive model-generated inline comments.
- Start with a test repository and tune `MAX_PATCH_CHARS`, `MAX_FILES`, and `MAX_FINDINGS` to match your review-depth and cost target.
