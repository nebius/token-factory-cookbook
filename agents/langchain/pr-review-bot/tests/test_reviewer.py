from app.models import ChangedFile, Finding, PullRequestContext, ReviewResult
from app.reviewer import added_lines_by_file, validate_review


def make_context() -> PullRequestContext:
    return PullRequestContext(
        owner="acme", repo="widget", number=2, title="Add widget", head_sha="abc",
        files=[ChangedFile(filename="app.py", status="modified", patch="@@ -4,2 +4,3 @@\n old()\n+new()\n+result()\n removed()")],
    )


def make_finding(line: int) -> Finding:
    return Finding(severity="high", path="app.py", line=line, title="A concrete defect", body="This change causes a concrete and reproducible user-impacting failure.", evidence="The added call passes an invalid value into the downstream operation.")


def test_added_lines_are_taken_from_right_side_of_hunks() -> None:
    assert added_lines_by_file([make_context().files[0].model_dump()]) == {"app.py": {5, 6}}


def test_validation_removes_invalid_and_duplicate_findings() -> None:
    review = ReviewResult(summary="Found an issue.", effort=3, poem=["A small rhyme"], findings=[make_finding(5), make_finding(4), make_finding(5)])
    result = validate_review(review, make_context(), max_findings=8)
    assert [item.line for item in result.findings] == [5]
    assert result.effort == 3
    assert result.poem == ["A small rhyme"]
    assert result.changes[0].files == ["app.py"]
