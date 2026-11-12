import json
import re
from collections.abc import Callable
from typing import Any

from deepagents import create_deep_agent
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI

from app.config import Settings
from app.models import ChangeSummary, Finding, PullRequestContext, ReviewResult

REVIEW_SYSTEM_PROMPT = " ".join(
    [
        "You are the lead reviewer for a GitHub pull request.",
        "Produce a high-signal, evidence-grounded review of changed code only.",
        "First delegate analysis to correctness-reviewer and security-reviewer, then synthesize.",
        "Only report a concrete, user-impacting defect introduced by this diff.",
        "Do not report style, naming, formatting, test coverage, existing code, or speculation.",
        "Call get_pull_request_context. Every finding must point to an added line.",
        "Write concise GitHub-flavored Markdown, using backticks for code identifiers and paths.",
        "Match CodeRabbit's review shape: a plain-language walkthrough, logically grouped changed-file summaries, a 1-5 review-effort estimate with minutes, a short changeset-specific poem, and concise actionable inline findings.",
        "Each finding body must explain the failure mode and impact; do not repeat the title or add an Evidence heading. Suggestions must be exact replacement code without Markdown fences.",
        "Final response must be JSON only: {summary: string, changes: [{label: string, files: [string], summary: string}], effort: integer 1-5, estimated_minutes: integer, poem: [3-5 short strings], findings: [{severity: critical|high|medium|low, path: string, line: number, title: string, body: string, suggestion: optional string, evidence: string}]}.",
        "Return an empty findings array when no issue survives falsification.",
    ]
)
CORRECTNESS_PROMPT = " ".join(
    [
        "Review the supplied PR for concrete correctness, data-loss, concurrency, API-contract, and error-handling defects.",
        "Call get_pull_request_context. Only report introduced issues on added lines with exact path, line, and evidence.",
        "Try to disprove each issue before returning a concise plain-text report for the lead.",
    ]
)
SECURITY_PROMPT = " ".join(
    [
        "Review the supplied PR for concrete authorization, injection, secret exposure, unsafe deserialization, SSRF, path traversal, and data-leak defects.",
        "Call get_pull_request_context. Only report introduced issues on added lines with exact path, line, and evidence.",
        "Try to disprove each issue before returning a concise plain-text report for the lead.",
    ]
)


def added_lines_by_file(files: list[dict[str, Any]]) -> dict[str, set[int]]:
    """Return right-side lines that GitHub permits inline review comments against."""
    result: dict[str, set[int]] = {}
    hunk = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@")
    for file in files:
        lines: set[int] = set()
        new_line: int | None = None
        for patch_line in (file.get("patch") or "").splitlines():
            match = hunk.match(patch_line)
            if match:
                new_line = int(match.group(1))
            elif new_line is not None:
                if patch_line.startswith("+") and not patch_line.startswith("+++"):
                    lines.add(new_line)
                    new_line += 1
                elif patch_line.startswith("-") and not patch_line.startswith("---"):
                    continue
                elif not patch_line.startswith("\\"):
                    new_line += 1
        result[file["filename"]] = lines
    return result


def _context_tool(context: PullRequestContext, max_patch_chars: int) -> Callable[..., str]:
    encoded = context.model_dump()
    remaining = max_patch_chars
    files: list[dict[str, Any]] = []
    for file in encoded["files"]:
        patch = file.get("patch") or ""
        limited_patch = patch[:remaining]
        remaining -= len(limited_patch)
        files.append({**file, "patch": limited_patch or None})
        if remaining <= 0:
            break
    encoded["files"] = files

    @tool
    def get_pull_request_context() -> str:
        """Read PR metadata, changed files, and unified-diff patches."""
        return json.dumps(encoded)

    return get_pull_request_context


def _last_text(messages: list[Any]) -> str:
    for message in reversed(messages):
        content = getattr(message, "content", "")
        if isinstance(content, str) and content.strip():
            return content
    raise ValueError("Agent returned no final text.")


def _parse_json(text: str) -> dict[str, Any]:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise ValueError("Agent did not return a JSON review.") from None
        return json.loads(match.group(0))


def validate_review(review: ReviewResult, context: PullRequestContext, max_findings: int) -> ReviewResult:
    allowed = added_lines_by_file([file.model_dump() for file in context.files])
    verified: list[Finding] = []
    seen: set[tuple[str, int, str]] = set()
    for finding in review.findings:
        key = (finding.path, finding.line, finding.title.lower())
        if finding.path in allowed and finding.line in allowed[finding.path] and key not in seen:
            if len(verified) < max_findings:
                verified.append(finding)
                seen.add(key)
    file_names = set(allowed)
    changes = [
        change.model_copy(update={"files": [path for path in change.files if path in file_names]})
        for change in review.changes
        if any(path in file_names for path in change.files)
    ]
    covered = {path for change in changes for path in change.files}
    changes.extend(
        ChangeSummary(
            label=file.status.title(),
            files=[file.filename],
            summary=f"{file.additions} additions and {file.deletions} deletions.",
        )
        for file in context.files
        if file.filename not in covered
    )
    return review.model_copy(update={"changes": changes, "findings": verified})


def review_pull_request(context: PullRequestContext, settings: Settings) -> ReviewResult:
    """Use Deep Agents' supervisor/subagent harness then validate agent output."""
    model = ChatOpenAI(
        model=settings.nebius_model,
        api_key=settings.nebius_api_key.get_secret_value(),
        base_url=settings.nebius_base_url,
        temperature=0,
    )
    context_tool = _context_tool(context, settings.max_patch_chars)
    agent = create_deep_agent(
        model=model,
        tools=[context_tool],
        system_prompt=REVIEW_SYSTEM_PROMPT,
        subagents=[
            {"name": "correctness-reviewer", "description": "Find concrete correctness defects in the changed code.", "system_prompt": CORRECTNESS_PROMPT, "tools": [context_tool]},
            {"name": "security-reviewer", "description": "Find concrete security defects in the changed code.", "system_prompt": SECURITY_PROMPT, "tools": [context_tool]},
        ],
    )
    prompt = f"Review PR #{context.number}; return at most {settings.max_findings} verified JSON findings."
    result = agent.invoke({"messages": [{"role": "user", "content": prompt}]})
    review = ReviewResult.model_validate(_parse_json(_last_text(result["messages"])))
    return validate_review(review, context, settings.max_findings)
