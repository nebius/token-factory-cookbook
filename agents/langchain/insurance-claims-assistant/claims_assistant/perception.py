"""Perception: read every submitted file into a `DocumentInsight`.

This pass is deterministic — it looks at *every* file exactly once so the reasoning steps
are always fully grounded (no relying on the model to remember to inspect something):

* text PDFs  -> extract the text layer (fast, exact for amounts/names/dates)
* scanned PDFs -> render page 1 and read it with the Cosmos3 vision model
* images     -> Cosmos3 vision (OCRs documents AND describes damage photos)
* JSON/text  -> read directly

Classification of what each document *is* happens later, in `agent.understand`.
"""

from __future__ import annotations

import json

from .ingest import (
    RawDoc,
    discover,
    encode_image,
    extract_pdf_text,
    load_stated_claim,
    pdf_first_page_image,
    pdf_has_text,
    read_text_file,
)
from .llm import chat_vision, extract_json
from .models import DamageObservation, DocumentInsight

_MAX_CHARS = 2500  # keep each document's content compact for the reasoning prompts

_VISION_PROMPT = """You are examining ONE file submitted with an insurance claim. It may be
a photograph of damage, OR a scanned/photographed document (repair invoice, estimate,
identity/verification record, policy, claim form, incident report). Respond with a single
JSON object:
{
  "is_damage_photo": true or false,
  "damaged_parts": ["..."],          // only if is_damage_photo, else []
  "severity": "minor|moderate|severe", // only if is_damage_photo
  "document_text": "transcribe visible text and key fields (name, amounts, dates, ids); empty if none",
  "looks_like": "short guess of what this is, e.g. 'repair invoice', 'accident photo', 'id document'"
}"""


def _vision_insight(doc: RawDoc, image_data_url: str) -> DocumentInsight:
    answer = chat_vision(image_data_url, _VISION_PROMPT)
    damage = None
    text = answer
    looks_like = ""
    try:
        data = json.loads(extract_json(answer))
        looks_like = str(data.get("looks_like", ""))
        text = str(data.get("document_text", "")).strip()
        if data.get("is_damage_photo"):
            damage = DamageObservation(
                file=doc.name,
                damaged_parts=list(data.get("damaged_parts", []) or []),
                severity=data.get("severity", "minor") or "minor",
                description=text or looks_like,
            )
    except (ValueError, TypeError):
        pass
    content = (f"[looks like: {looks_like}]\n" if looks_like else "") + text
    source = "pdf-vision" if doc.category == "pdf" else "image"
    return DocumentInsight(file=doc.name, source=source, content=content[:_MAX_CHARS], damage=damage)


def _read_doc(doc: RawDoc) -> DocumentInsight:
    if doc.category == "image":
        return _vision_insight(doc, encode_image(doc.path))

    if doc.category == "pdf":
        if pdf_has_text(doc.path):
            return DocumentInsight(
                file=doc.name, source="pdf-text", content=extract_pdf_text(doc.path)[:_MAX_CHARS]
            )
        return _vision_insight(doc, pdf_first_page_image(doc.path))  # scanned PDF

    if doc.category == "json":
        try:
            pretty = json.dumps(json.loads(doc.path.read_text()), indent=2)
        except (ValueError, OSError):
            pretty = read_text_file(doc.path)
        return DocumentInsight(file=doc.name, source="json", content=pretty[:_MAX_CHARS])

    # text or unknown — best effort as text
    return DocumentInsight(file=doc.name, source="text", content=read_text_file(doc.path)[:_MAX_CHARS])


def perceive(claim_dir) -> tuple[list[DocumentInsight], dict]:
    """Read every file in the claim folder. Returns (insights, stated_claim_json)."""
    _root, docs = discover(claim_dir)
    stated_claim = load_stated_claim(docs)
    insights = [_read_doc(doc) for doc in docs]
    return insights, stated_claim
