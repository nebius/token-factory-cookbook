"""Typed schemas for the claims pipeline.

Flow: `DocumentInsight` (one per file, from perception) → `ClaimUnderstanding` (the agent's
read of what the claim is, shown to the user to confirm) → `ClaimAssessment` (the final
summary for the assessor). All are Pydantic so the model's JSON is validated before
anything downstream trusts it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Severity = Literal["minor", "moderate", "severe"]
# Check outcomes, aligned with the insurer triage rubric used by the showcase oracles:
#   pass | fail | partial (some expected docs absent) | warn |
#   missing (no verification record) | name_mismatch | not_applicable
CheckResult = Literal[
    "pass", "fail", "partial", "warn", "missing", "name_mismatch", "not_applicable"
]


class _Model(BaseModel):
    # LLMs sometimes emit numbers where a string is expected (e.g. an amount as 350 rather
    # than "350"). Coerce them instead of failing validation on an otherwise-fine object.
    model_config = ConfigDict(coerce_numbers_to_str=True)


class DocumentInsight(_Model):
    """What perception read out of a single file (before the model classifies it)."""

    file: str
    source: str  # pdf-text | pdf-vision | image | json | text
    content: str = ""  # extracted text, OCR, or a vision description
    damage: "DamageObservation | None" = None  # set when the file is a damage photo


class DamageObservation(_Model):
    """Visible damage in one photo."""

    file: str = ""
    damaged_parts: list[str] = Field(default_factory=list)
    severity: Severity = "minor"
    description: str = ""


class DetectedDocument(_Model):
    """The agent's classification of one submitted file."""

    file: str
    doc_type: str  # e.g. claim_form, policy_declaration, invoice, estimate, verification, id, incident_report, registration, damage_photo, other
    summary: str = ""


class ClaimUnderstanding(_Model):
    """The agent's read of the claim — shown to the user to confirm before assessing."""

    claim_type: str = "unknown"  # auto | property | other
    claim_id: str = ""
    claimant_name: str = ""
    incident_summary: str = ""
    claimed_amount: str = ""
    detected_documents: list[DetectedDocument] = Field(default_factory=list)
    likely_missing: list[str] = Field(default_factory=list)
    open_questions: list[str] = Field(default_factory=list)
    confirmation_prompt: str = ""  # one-liner: "This looks like ... — correct?"


class Inconsistency(_Model):
    """A mismatch between what the claimant stated and the evidence."""

    field: str
    stated_value: str = ""
    observed_value: str = ""
    severity: Severity = "moderate"
    explanation: str = ""


class Checks(_Model):
    """The four assessor checks (mirrors an insurer's triage rubric)."""

    document_completeness: CheckResult = "pass"
    damage_description_consistency: CheckResult = "pass"
    amount_consistency: CheckResult = "pass"
    identity_consistency: CheckResult = "pass"


class ClaimAssessment(_Model):
    """The structured summary handed to a human assessor."""

    claim_id: str = ""
    policy_number: str = ""
    claim_type: str = "unknown"
    incident_summary: str = ""
    damage_findings: list[DamageObservation] = Field(default_factory=list)
    documents_present: list[str] = Field(default_factory=list)
    missing_documents: list[str] = Field(default_factory=list)
    inconsistencies: list[Inconsistency] = Field(default_factory=list)
    checks: Checks = Field(default_factory=Checks)
    fraud_risk: Literal["low", "medium", "high"] = "low"
    completeness: Literal["complete", "incomplete"] = "incomplete"
    recommended_action: Literal[
        "approve", "request_more_info", "manual_review", "deny"
    ] = "manual_review"
    confidence: Literal["low", "medium", "high"] = "low"
    assessor_notes: str = ""
    audit_trail: list[str] = Field(default_factory=list)


DocumentInsight.model_rebuild()
