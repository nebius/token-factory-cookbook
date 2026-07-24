"""The claims agent: perceive → understand → (confirm) → assess.

The reasoning brain (Nemotron Ultra 253B via LangChain `ChatOpenAI`) never has to remember
to look at a document — perception already read every file. Its job is judgement:

1. **understand** — classify each document, infer the claim type, and write a one-line
   summary the human can confirm, plus any follow-up questions.
2. **confirm** — the caller (CLI or Streamlit) shows that understanding and lets the human
   accept, correct, or answer the follow-ups. `--yes` / auto mode skips the prompt.
3. **assess** — with the confirmed understanding and all evidence, produce the final typed
   `ClaimAssessment` (checks, inconsistencies, recommendation).

Each model call asks for one JSON object and is validated with Pydantic (with a retry), so
the output is always well-formed and grounded in the evidence.
"""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from langchain_core.messages import HumanMessage, SystemMessage

from .config import text_llm
from .llm import extract_json
from .models import ClaimAssessment, ClaimUnderstanding, DocumentInsight
from .perception import perceive

perceive = perceive  # re-export

# What a complete bundle usually looks like, to help the model spot gaps.
_DOC_HINTS = (
    "Typical AUTO claim: claim form, damage photos, policy declaration, identity/"
    "verification record, repair estimate, repair invoice, incident/police report, vehicle "
    "registration.\nTypical PROPERTY claim: claim form, damage photos, policy declaration, "
    "identity/verification record, contractor estimate, final paid invoice, incident report."
)

_UNDERSTAND_SYSTEM = f"""You are an insurance claims intake assistant. You are given every
document submitted with a claim (already read for you) and any machine-readable claim form.

Work out what this claim IS — do not judge it yet:
- the claim type (auto | property | other),
- the claimant and a one-line incident summary,
- the amount being claimed,
- classify EACH submitted file (doc_type: claim_form, policy_declaration, invoice,
  estimate, verification/id, incident_report, registration, damage_photo, other),
- which standard supporting documents appear to be MISSING for this claim type,
- follow-up questions a human should ask (missing docs, anything ambiguous).

{_DOC_HINTS}

Return ONE JSON object, no other text:
{{
  "claim_type": "auto|property|other",
  "claim_id": "...",
  "claimant_name": "...",
  "incident_summary": "...",
  "claimed_amount": "...",
  "detected_documents": [{{"file": "...", "doc_type": "...", "summary": "..."}}],
  "likely_missing": ["..."],
  "open_questions": ["..."],
  "confirmation_prompt": "one sentence for a human to confirm, e.g. 'This looks like an auto collision claim by Jane Doe for front-end damage, ~$2,000 claimed — is that correct?'"
}}"""

_ASSESS_SYSTEM = """You are an insurance claims triage assistant producing the FINAL
assessment for a human assessor. You are given: every submitted document (already read),
the machine-readable claim form if any, your earlier understanding of the claim, and any
note or answers the human gave when confirming.

Compare what the claimant STATED against the EVIDENCE and run four checks. Judge
MATERIALITY, not exact wording — an honest claim will never match the evidence
word-for-word. Use EXACTLY these values for each check:
- document_completeness: "pass" if all expected documents are present; "fail" if a REQUIRED
  core document is absent — the claim form, the identity/verification record, or damage
  evidence (this is the value to use when there is no verification/identity document at all);
  "partial" if only a SECONDARY supporting document is absent (e.g. a final paid invoice, an
  estimate, or a registration record) while the core documents are present. Cross-check the
  "attached documents" the claim form lists against the files actually present.
- damage_description_consistency: "pass" if the photos show the SAME incident and broadly
  the same damaged area/scale as described — a one-step severity wording difference (e.g.
  "moderate" vs "severe") or extra detail is still "pass". "fail" only on a gross
  contradiction (e.g. "minor cosmetic scratch" but the vehicle is destroyed, or damage to a
  completely different part).
- amount_consistency: "pass" when the claimed amount is within roughly 15% of the
  estimate/invoice total (small rounding/tax differences are "pass"); "fail" when the figures
  diverge materially (e.g. the documented repair cost is many times the claimed amount).
- identity_consistency: "pass" if the claimant name agrees across the form and the
  verification/identity record; "name_mismatch" if the names differ (e.g. a surname spelling
  mismatch); "missing" if there is NO verification/identity record at all.

Then decide recommended_action:
- approve: every check is "pass" and there is no MATERIAL inconsistency,
- request_more_info: the ONLY issue is a missing secondary document, with NO discrepancy in
  the evidence that is present,
- manual_review: there is a genuine discrepancy needing human judgement — in particular ANY
  identity name_mismatch, or a single failed/partial check, belongs here (not approve, not a
  simple info request),
- deny: a clear material contradiction or likely fraud (e.g. several checks fail together).
Only list MATERIAL inconsistencies (ones that would change an assessor's decision) — do NOT
list immaterial numeric rounding or subjective wording differences. Set fraud_risk
(low|medium|high) and confidence (low|medium|high) to match.

Return ONE JSON object, no other text:
{
  "claim_id": "...", "policy_number": "...", "claim_type": "auto|property|other",
  "incident_summary": "...",
  "damage_findings": [{"file": "...", "damaged_parts": ["..."], "severity": "minor|moderate|severe", "description": "..."}],
  "documents_present": ["..."], "missing_documents": ["..."],
  "inconsistencies": [{"field": "...", "stated_value": "...", "observed_value": "...", "severity": "minor|moderate|severe", "explanation": "..."}],
  "checks": {"document_completeness": "pass|partial|fail", "damage_description_consistency": "pass|fail", "amount_consistency": "pass|fail", "identity_consistency": "pass|name_mismatch|missing"},
  "fraud_risk": "low|medium|high", "completeness": "complete|incomplete",
  "recommended_action": "approve|request_more_info|manual_review|deny",
  "confidence": "low|medium|high", "assessor_notes": "short guidance for the human assessor"
}
Base every field only on the provided evidence."""


def _evidence_block(insights: list[DocumentInsight], stated_claim: dict) -> str:
    parts = []
    if stated_claim:
        import json

        parts.append("MACHINE-READABLE CLAIM FORM:\n" + json.dumps(stated_claim, indent=2))
    parts.append(f"SUBMITTED FILES ({len(insights)}):")
    for i in insights:
        block = f"\n--- {i.file}  (read via {i.source}) ---\n{i.content or '(no readable content)'}"
        if i.damage:
            block += (f"\n[VISIBLE DAMAGE: parts={i.damage.damaged_parts}, "
                      f"severity={i.damage.severity}]")
        parts.append(block)
    return "\n".join(parts)


def _json_call(system: str, user: str, model_cls, retries: int = 2):
    """Invoke the reasoning model and validate its JSON, retrying on malformed output."""
    llm = text_llm()
    messages = [SystemMessage(content=system), HumanMessage(content=user)]
    last_err = ""
    for _ in range(retries + 1):
        resp = llm.invoke(messages)
        content = resp.content if isinstance(resp.content, str) else str(resp.content)
        try:
            return model_cls.model_validate_json(extract_json(content))
        except Exception as exc:
            last_err = str(exc)
            messages.append(resp)
            messages.append(HumanMessage(
                content=f"That was invalid ({exc}). Return ONE valid JSON object matching "
                        "the schema exactly, and nothing else."
            ))
    raise RuntimeError(f"Model did not return a valid {model_cls.__name__}: {last_err}")


def understand(insights: list[DocumentInsight], stated_claim: dict) -> ClaimUnderstanding:
    """Classify documents and infer what the claim is (for the human to confirm)."""
    user = _evidence_block(insights, stated_claim) + (
        "\n\nProduce your understanding of this claim as the specified JSON."
    )
    return _json_call(_UNDERSTAND_SYSTEM, user, ClaimUnderstanding)


_ID_DOC_HINTS = ("verif", "identity", "id_", "_id", "kyc")


def _doc_signals(understanding: ClaimUnderstanding, stated_claim: dict) -> str:
    """Deterministic facts about which document types are present, to anchor the checks."""
    types = sorted({d.doc_type for d in understanding.detected_documents})
    has_identity = any(
        d.doc_type in {"verification", "customer_verification", "id", "identity"}
        or any(h in d.doc_type.lower() for h in _ID_DOC_HINTS)
        for d in understanding.detected_documents
    )
    lines = [
        f"DETECTED DOCUMENT TYPES: {types}",
        f"IDENTITY / VERIFICATION DOCUMENT PRESENT: {'yes' if has_identity else 'NO — none found'}",
    ]
    if understanding.likely_missing:
        lines.append(f"INTAKE FLAGGED AS LIKELY MISSING: {understanding.likely_missing}")
    attached = stated_claim.get("attached_documents") if isinstance(stated_claim, dict) else None
    if attached:
        lines.append(f"CLAIM FORM CLAIMS THESE WERE ATTACHED: {attached}")
    return "\n".join(lines)


def assess(
    insights: list[DocumentInsight],
    stated_claim: dict,
    understanding: ClaimUnderstanding,
    user_note: str = "",
) -> ClaimAssessment:
    """Produce the final assessment, grounded in all evidence and the confirmed understanding."""
    user = _evidence_block(insights, stated_claim)
    user += "\n\nDOCUMENT SIGNALS (deterministic):\n" + _doc_signals(understanding, stated_claim)
    user += "\n\nYOUR EARLIER UNDERSTANDING:\n" + understanding.model_dump_json(indent=2)
    if user_note.strip():
        user += f"\n\nHUMAN CONFIRMATION / ANSWERS:\n{user_note.strip()}"
    user += "\n\nNow produce the final claim assessment as the specified JSON."
    assessment = _json_call(_ASSESS_SYSTEM, user, ClaimAssessment)
    assessment.audit_trail = [f"read:{i.file}" for i in insights]
    if not assessment.damage_findings:
        assessment.damage_findings = [i.damage for i in insights if i.damage]
    return assessment


def run_agent(
    claim_dir: str | Path,
    confirm_fn: Callable[[ClaimUnderstanding], tuple[bool, str]] | None = None,
) -> ClaimAssessment:
    """End-to-end convenience runner (used by the CLI).

    `confirm_fn(understanding) -> (proceed, note)` is called between understanding and
    assessment. If omitted, the run proceeds automatically with no note.
    """
    insights, stated_claim = perceive(claim_dir)
    understanding = understand(insights, stated_claim)
    note = ""
    if confirm_fn is not None:
        proceed, note = confirm_fn(understanding)
        if not proceed:
            raise KeyboardInterrupt("Assessment cancelled by user.")
    return assess(insights, stated_claim, understanding, note)
