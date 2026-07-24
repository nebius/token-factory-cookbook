"""Streamlit UI for the Insurance Claims Assistant.

    streamlit run app.py

Drop in a claim folder (or upload files, or point at a local path). The agent reads every
document, shows you what it thinks the claim is, lets you confirm or correct it and answer
any follow-up questions, then produces the structured assessment.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import streamlit as st

from claims_assistant.agent import assess, perceive, understand
from claims_assistant.config import BASE_URL, TEXT_MODEL, VISION_MODEL
from claims_assistant.models import ClaimAssessment
from claims_assistant.report import render_markdown, render_understanding

SAMPLE_CLAIM = Path(__file__).parent / "sample_claim"

st.set_page_config(page_title="Insurance Claims Assistant", page_icon="🚗", layout="wide")


def _reset():
    for k in ("stage", "insights", "stated", "understanding", "assessment", "claim_label"):
        st.session_state.pop(k, None)


def _analyze(claim_dir: Path, label: str):
    with st.spinner("Reading every document (PDFs, photos, forms)…"):
        insights, stated = perceive(claim_dir)
    with st.spinner("Working out what this claim is…"):
        understanding = understand(insights, stated)
    st.session_state.update(
        stage="understood", insights=insights, stated=stated,
        understanding=understanding, claim_label=label,
    )


def _uploads_to_dir(files) -> Path:
    tmp = Path(tempfile.mkdtemp(prefix="claim_"))
    for up in files:
        (tmp / Path(up.name).name).write_bytes(up.getvalue())
    return tmp


def _render_assessment(a: ClaimAssessment) -> None:
    action_style = {
        "approve": st.success, "request_more_info": st.warning,
        "manual_review": st.info, "deny": st.error,
    }.get(a.recommended_action, st.info)
    action_style(f"**Recommendation:** {a.recommended_action.replace('_', ' ').title()}")

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Claim type", a.claim_type)
    c2.metric("Fraud risk", a.fraud_risk.title())
    c3.metric("Completeness", a.completeness.title())
    c4.metric("Confidence", a.confidence.title())

    st.markdown(render_markdown(a))
    with st.expander("Raw JSON assessment"):
        st.json(json.loads(a.model_dump_json()))


def main() -> None:
    st.title("🚗 Insurance Claims Assistant")
    st.caption("Drop a folder of claim documents — Nemotron Ultra 253B reasons, Cosmos3 sees.")

    with st.sidebar:
        st.subheader("Models")
        st.write(f"**Reasoning:** `{TEXT_MODEL}`")
        st.write(f"**Vision:** `{VISION_MODEL}`")
        st.caption(f"Endpoint: {BASE_URL}")
        if st.button("↺ Start over"):
            _reset()
            st.rerun()

    stage = st.session_state.get("stage", "start")

    # --- Stage 1: pick a claim and analyze ---------------------------------
    if stage == "start":
        st.subheader("1. Choose a claim")
        tab_sample, tab_path, tab_upload = st.tabs(
            ["Bundled sample", "Local folder path", "Upload files"]
        )
        with tab_sample:
            if st.button("Analyze bundled sample", type="primary"):
                _analyze(SAMPLE_CLAIM, "bundled sample")
                st.rerun()
        with tab_path:
            path = st.text_input("Path to a claim folder on this machine")
            if st.button("Analyze folder", type="primary", disabled=not path):
                p = Path(path).expanduser()
                if not p.is_dir():
                    st.error(f"Not a folder: {p}")
                else:
                    _analyze(p, p.name)
                    st.rerun()
        with tab_upload:
            files = st.file_uploader(
                "Upload all claim files (PDFs, photos, JSON form)",
                accept_multiple_files=True,
                type=["pdf", "jpg", "jpeg", "png", "webp", "json", "txt"],
            )
            if st.button("Analyze uploads", type="primary", disabled=not files):
                _analyze(_uploads_to_dir(files), f"{len(files)} uploaded file(s)")
                st.rerun()

    # --- Stage 2: confirm understanding ------------------------------------
    elif stage == "understood":
        u = st.session_state["understanding"]
        st.subheader("2. Confirm what the agent understood")
        st.caption(f"Source: {st.session_state.get('claim_label', '')}")
        st.markdown(render_understanding(u))
        note = st.text_area(
            "Corrections or answers to the follow-up questions (optional)",
            placeholder="e.g. 'The verification record is attached separately' or 'claim type is property'",
        )
        col_a, col_b = st.columns(2)
        if col_a.button("✅ Confirm & assess", type="primary"):
            with st.spinner("Assessing the claim against all evidence…"):
                st.session_state["assessment"] = assess(
                    st.session_state["insights"], st.session_state["stated"], u, note,
                )
            st.session_state["stage"] = "done"
            st.rerun()
        if col_b.button("✖ Cancel / start over"):
            _reset()
            st.rerun()

    # --- Stage 3: assessment -----------------------------------------------
    elif stage == "done":
        st.subheader("3. Assessment")
        _render_assessment(st.session_state["assessment"])
        if st.button("Assess another claim"):
            _reset()
            st.rerun()


if __name__ == "__main__":
    main()
