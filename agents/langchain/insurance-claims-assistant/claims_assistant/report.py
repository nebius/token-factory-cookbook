"""Render the agent's understanding and final assessment as human-readable markdown."""

from __future__ import annotations

from .models import ClaimAssessment, ClaimUnderstanding

_ACTION_LABEL = {
    "approve": "✅ Approve",
    "request_more_info": "📩 Request more information",
    "manual_review": "🔍 Route to manual review",
    "deny": "⛔ Deny",
}
_RISK_LABEL = {"low": "🟢 Low", "medium": "🟡 Medium", "high": "🔴 High"}
_CHECK_LABEL = {
    "pass": "✅ pass",
    "fail": "❌ fail",
    "warn": "⚠️ warn",
    "missing": "🚫 missing",
    "not_applicable": "— n/a",
}


def render_understanding(u: ClaimUnderstanding) -> str:
    lines = [f"### {u.confirmation_prompt or 'Here is what I understand about this claim.'}", ""]
    lines.append(f"- **Claim type:** {u.claim_type}")
    if u.claim_id:
        lines.append(f"- **Claim ID:** {u.claim_id}")
    if u.claimant_name:
        lines.append(f"- **Claimant:** {u.claimant_name}")
    if u.claimed_amount:
        lines.append(f"- **Claimed amount:** {u.claimed_amount}")
    if u.incident_summary:
        lines.append(f"- **Incident:** {u.incident_summary}")
    lines.append("")
    lines.append("**Documents detected:**")
    for d in u.detected_documents:
        lines.append(f"- `{d.file}` → **{d.doc_type}** {('· ' + d.summary) if d.summary else ''}")
    if u.likely_missing:
        lines.append("")
        lines.append(f"**Likely missing:** {', '.join(u.likely_missing)}")
    if u.open_questions:
        lines.append("")
        lines.append("**Follow-up questions:**")
        for q in u.open_questions:
            lines.append(f"- {q}")
    return "\n".join(lines)


def render_markdown(a: ClaimAssessment) -> str:
    lines: list[str] = []
    lines.append(f"# Claim Assessment — {a.claim_id or 'unknown claim'}")
    lines.append("")
    lines.append(f"- **Policy number:** {a.policy_number or 'n/a'}")
    lines.append(f"- **Claim type:** {a.claim_type}")
    lines.append(f"- **Recommendation:** {_ACTION_LABEL.get(a.recommended_action, a.recommended_action)}")
    lines.append(f"- **Fraud risk:** {_RISK_LABEL.get(a.fraud_risk, a.fraud_risk)}")
    lines.append(f"- **Completeness:** {a.completeness}")
    lines.append(f"- **Confidence:** {a.confidence}")
    lines.append("")

    lines.append("## Checks")
    c = a.checks
    lines.append(f"- Document completeness: {_CHECK_LABEL.get(c.document_completeness, c.document_completeness)}")
    lines.append(f"- Damage vs description: {_CHECK_LABEL.get(c.damage_description_consistency, c.damage_description_consistency)}")
    lines.append(f"- Amount consistency: {_CHECK_LABEL.get(c.amount_consistency, c.amount_consistency)}")
    lines.append(f"- Identity consistency: {_CHECK_LABEL.get(c.identity_consistency, c.identity_consistency)}")
    lines.append("")

    if a.incident_summary:
        lines.append("## Incident summary")
        lines.append(a.incident_summary)
        lines.append("")

    lines.append("## Visible damage")
    if a.damage_findings:
        for d in a.damage_findings:
            parts = ", ".join(d.damaged_parts) if d.damaged_parts else "—"
            lines.append(f"- **{d.file}** ({d.severity}): {d.description or ''}")
            lines.append(f"  - Parts: {parts}")
    else:
        lines.append("- No damage findings recorded.")
    lines.append("")

    lines.append("## Documentation")
    lines.append(f"- **Present:** {', '.join(a.documents_present) or 'none'}")
    lines.append(f"- **Missing:** {', '.join(a.missing_documents) or 'none'}")
    lines.append("")

    lines.append("## Inconsistencies")
    if a.inconsistencies:
        lines.append("| Field | Stated | Observed | Severity | Note |")
        lines.append("| --- | --- | --- | --- | --- |")
        for i in a.inconsistencies:
            lines.append(
                f"| {i.field} | {i.stated_value} | {i.observed_value} | {i.severity} | {i.explanation} |"
            )
    else:
        lines.append("- None detected.")
    lines.append("")

    if a.assessor_notes:
        lines.append("## Notes for assessor")
        lines.append(a.assessor_notes)
        lines.append("")

    if a.audit_trail:
        lines.append("## Audit trail")
        lines.append("Files read: " + ", ".join(s.removeprefix("read:") for s in a.audit_trail))
        lines.append("")

    return "\n".join(lines)
