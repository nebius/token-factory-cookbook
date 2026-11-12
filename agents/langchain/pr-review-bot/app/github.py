import time
from typing import Any

import httpx
import jwt

from app.config import Settings
from app.models import ChangedFile, PullRequestContext, ReviewResult

WALKTHROUGH_MARKER = "<!-- deep-pr-reviewer-walkthrough -->"
SEVERITY = {
    "critical": ("🚨 Critical issue", "🔴 Critical"),
    "high": ("⚠️ Potential issue", "🟠 Major"),
    "medium": ("⚠️ Potential issue", "🟡 Minor"),
    "low": ("🧹 Nitpick", "⚪ Trivial"),
}


class GitHubClient:
    """Small GitHub REST client with GitHub App or token authentication."""

    api_url = "https://api.github.com"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.client = httpx.AsyncClient(
            base_url=self.api_url,
            headers={
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "User-Agent": "deep-pr-reviewer",
            },
            timeout=httpx.Timeout(45.0),
        )
        self._installation_tokens: dict[int, tuple[str, float]] = {}

    async def aclose(self) -> None:
        await self.client.aclose()

    def _app_jwt(self) -> str:
        now = int(time.time())
        private_key = self.settings.github_app_private_key
        assert private_key is not None
        return jwt.encode(
            {"iat": now - 60, "exp": now + 540, "iss": self.settings.github_app_id},
            private_key.get_secret_value().replace("\\n", "\n"),
            algorithm="RS256",
        )

    async def _token_for(self, installation_id: int | None) -> str:
        if installation_id is None:
            token = self.settings.github_token
            if token is None:
                raise ValueError("Webhook had no installation and GITHUB_TOKEN is not configured.")
            return token.get_secret_value()
        cached = self._installation_tokens.get(installation_id)
        if cached and cached[1] > time.time() + 60:
            return cached[0]
        response = await self.client.post(
            f"/app/installations/{installation_id}/access_tokens",
            headers={"Authorization": f"Bearer {self._app_jwt()}"},
        )
        response.raise_for_status()
        token = response.json()["token"]
        self._installation_tokens[installation_id] = (token, time.time() + 3000)
        return token

    async def _request(
        self, method: str, path: str, installation_id: int | None, **kwargs: Any
    ) -> httpx.Response:
        token = await self._token_for(installation_id)
        response = await self.client.request(
            method, path, headers={"Authorization": f"Bearer {token}"}, **kwargs
        )
        response.raise_for_status()
        return response

    async def get_pull_request(
        self, owner: str, repo: str, number: int, installation_id: int | None
    ) -> PullRequestContext:
        pull = await self._request("GET", f"/repos/{owner}/{repo}/pulls/{number}", installation_id)
        files: list[ChangedFile] = []
        page = 1
        while len(files) < self.settings.max_files:
            response = await self._request(
                "GET",
                f"/repos/{owner}/{repo}/pulls/{number}/files",
                installation_id,
                params={"per_page": 100, "page": page},
            )
            page_files = response.json()
            if not page_files:
                break
            for item in page_files:
                files.append(
                    ChangedFile(
                        filename=item["filename"], status=item["status"], patch=item.get("patch"),
                        additions=item.get("additions", 0), deletions=item.get("deletions", 0),
                    )
                )
                if len(files) == self.settings.max_files:
                    break
            page += 1
        data = pull.json()
        return PullRequestContext(
            owner=owner, repo=repo, number=number, title=data["title"], body=data.get("body"),
            head_sha=data["head"]["sha"], files=files,
        )

    async def submit_review(
        self, context: PullRequestContext, review: ReviewResult, installation_id: int | None
    ) -> None:
        comments = [
            {"path": f.path, "line": f.line, "side": "RIGHT", "body": format_finding(f.model_dump())}
            for f in review.findings
        ]
        await self._upsert_walkthrough(context, review, installation_id)
        body = f"**Actionable comments posted: {len(comments)}**"
        if not comments:
            body += "\n\n_No actionable issues found in the reviewed diff._"
        await self._request(
            "POST", f"/repos/{context.owner}/{context.repo}/pulls/{context.number}/reviews",
            installation_id,
            json={"commit_id": context.head_sha, "body": body, "event": "COMMENT", "comments": comments},
        )

    async def _upsert_walkthrough(
        self, context: PullRequestContext, review: ReviewResult, installation_id: int | None
    ) -> None:
        path = f"/repos/{context.owner}/{context.repo}/issues/{context.number}/comments"
        response = await self._request("GET", path, installation_id, params={"per_page": 100})
        body = format_walkthrough(review)
        existing = next(
            (comment for comment in response.json() if WALKTHROUGH_MARKER in comment.get("body", "")),
            None,
        )
        if existing:
            await self._request(
                "PATCH",
                f"/repos/{context.owner}/{context.repo}/issues/comments/{existing['id']}",
                installation_id,
                json={"body": body},
            )
        else:
            await self._request("POST", path, installation_id, json={"body": body})


def format_finding(finding: dict[str, Any]) -> str:
    kind, severity = SEVERITY[finding["severity"]]
    parts = [
        f"_{kind}_ | _{severity}_",
        f"**{finding['title']}**",
        finding["body"],
    ]
    if finding.get("suggestion"):
        parts.append(
            f"<details>\n<summary>📝 Committable suggestion</summary>\n\n"
            f"```suggestion\n{finding['suggestion']}\n```\n\n</details>"
        )
    return "\n\n".join(parts)


def format_walkthrough(review: ReviewResult) -> str:
    effort_names = {1: "Trivial", 2: "Easy", 3: "Moderate", 4: "Complex", 5: "Very complex"}
    def cell(value: str) -> str:
        return value.replace("|", "\\|").replace("\n", "<br>")

    rows = "\n".join(
        f"|**{cell(change.label)}** <br> {'<br>'.join(f'`{cell(path)}`' for path in change.files)}|{cell(change.summary)}|"
        for change in review.changes
    ) or "| Review | No changed-file summary was generated. |"
    poem = "\n".join(f"> {line}" for line in review.poem) or "> Changes land softly; the diff tells the tale. 🐰"
    return f"""{WALKTHROUGH_MARKER}
<details>
<summary>📝 Walkthrough</summary>

## Walkthrough

{review.summary}

## Changes

|Cohort / File(s)|Summary|
|---|---|
{rows}

## Estimated code review effort

🎯 {review.effort} ({effort_names[review.effort]}) | ⏱️ ~{review.estimated_minutes} minutes

## Poem

{poem}

</details>"""
