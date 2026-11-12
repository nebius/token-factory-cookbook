import hashlib
import hmac

from app.github import format_finding, format_walkthrough
from app.main import should_review, valid_signature
from app.models import ChangeSummary, ReviewResult


def test_signature_validation() -> None:
    body, secret = b'{"hello":"world"}', "secret"
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert valid_signature(body, signature, secret)
    assert not valid_signature(body, "sha256=nope", secret)


def test_draft_pr_is_not_reviewed_by_default() -> None:
    class TestSettings:
        review_drafts = False

    assert not should_review({"action": "opened", "pull_request": {"draft": True}}, TestSettings())


def test_coderabbit_style_markdown() -> None:
    review = ReviewResult(
        summary="Adds a safer parser.",
        changes=[ChangeSummary(label="Parser", files=["app/parser.py"], summary="Validates input.")],
        effort=2,
        estimated_minutes=10,
        poem=["Inputs arrive,", "Safe branches thrive. 🐰"],
    )
    walkthrough = format_walkthrough(review)
    assert "<summary>📝 Walkthrough</summary>" in walkthrough
    assert "|**Parser** <br> `app/parser.py`|Validates input.|" in walkthrough
    assert "🎯 2 (Easy) | ⏱️ ~10 minutes" in walkthrough
    assert "> Safe branches thrive. 🐰" in walkthrough

    finding = {
        "severity": "high", "title": "Reject empty tokens", "body": "Empty tokens bypass validation.",
        "evidence": "The new branch accepts an empty string.", "suggestion": "raise ValueError()",
    }
    comment = format_finding(finding)
    assert "_⚠️ Potential issue_ | _🟠 Major_" in comment
    assert "```suggestion\nraise ValueError()\n```" in comment
