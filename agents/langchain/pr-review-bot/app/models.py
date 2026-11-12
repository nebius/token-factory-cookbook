from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["critical", "high", "medium", "low"]


class ChangedFile(BaseModel):
    filename: str
    status: str
    patch: str | None = None
    additions: int = 0
    deletions: int = 0


class PullRequestContext(BaseModel):
    owner: str
    repo: str
    number: int
    title: str
    body: str | None = None
    head_sha: str
    files: list[ChangedFile]


class Finding(BaseModel):
    severity: Severity
    path: str
    line: int = Field(ge=1)
    title: str = Field(min_length=3, max_length=120)
    body: str = Field(min_length=20, max_length=1500)
    suggestion: str | None = Field(default=None, max_length=1000)
    evidence: str = Field(min_length=10, max_length=1000)


class ChangeSummary(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    files: list[str] = Field(min_length=1)
    summary: str = Field(min_length=1, max_length=500)


class ReviewResult(BaseModel):
    summary: str = Field(min_length=1, max_length=2000)
    changes: list[ChangeSummary] = Field(default_factory=list)
    effort: int = Field(default=1, ge=1, le=5)
    estimated_minutes: int = Field(default=5, ge=1, le=240)
    poem: list[str] = Field(default_factory=list, max_length=5)
    findings: list[Finding] = Field(default_factory=list)
