"""LeadGuard event ops: ask Kimi K3.1 Pro what is happening at a conference's booths.

Run: uv run streamlit run app.py
"""

from __future__ import annotations

import pandas as pd
import streamlit as st

import agent
import event
import kimi
import tools

st.set_page_config(page_title="LeadGuard event ops", page_icon="🛡️", layout="wide")

SCENARIOS = {
    "wifi": ("Wi-Fi drops at the Radar booth", lambda ev: event.wifi_drop(ev, "radar")),
    "ghost": ("A badge that never checked in is scanned", lambda ev: event.ghost_badge(ev, "radar")),
    "teleport": ("One badge at two booths in 20 seconds", event.teleport),
    "stuck": ("The Dash0 scanner can't sync", lambda ev: event.scanner_stuck(ev, "dash0")),
}
QUESTIONS = [
    "Were any leads lost at the Radar booth in the last hour?",
    "Which booth needs attention right now, and why?",
    "Draft a short note to the Radar sponsor about this morning.",
]


def fresh_event() -> event.Event:
    ev = event.synthetic()
    for key in st.session_state.get("scenarios", []):
        SCENARIOS[key][1](ev)
    return ev


if "scenarios" not in st.session_state:
    st.session_state.scenarios = ["wifi", "ghost"]
    st.session_state.chat = []
ev = st.session_state.get("event") or fresh_event()
ev.drafts = st.session_state.get("drafts", [])
st.session_state.event = ev

with st.sidebar:
    st.header("Scenario")
    st.caption("Synthetic conference: 120 attendees, 5 booths. Pick what goes wrong this morning.")
    chosen = [k for k, (label, _) in SCENARIOS.items() if st.checkbox(label, value=k in st.session_state.scenarios)]
    if chosen != st.session_state.scenarios:
        st.session_state.scenarios = chosen
        st.session_state.event = None
        st.session_state.drafts = []
        st.rerun()
    st.divider()
    st.caption("The integrity checks run locally with no model. Kimi only reads their results through tools and explains them.")

st.title("LeadGuard event ops")
st.caption("Check-ins you can trust. Leads sponsors can trust. Kimi K3.1 Pro on Nebius Token Factory, with tools and a human approval step.")

stats = tools.get_checkin_stats(ev)
health = tools.get_booth_health(ev)
found = tools.list_anomalies(ev)
c1, c2, c3, c4 = st.columns(4)
c1.metric("Checked in", f"{stats['checked_in']} / {stats['registered']}")
c2.metric("Lead scans", sum(b["scans"] for b in health["booths"]))
c3.metric("Scans waiting on devices", sum(b["scans_waiting_on_devices"] for b in health["booths"]))
c4.metric("Open anomalies", found["count"])

left, right = st.columns([3, 2], gap="large")
with left:
    st.subheader("Ask ops")
    for turn in st.session_state.chat:
        with st.chat_message(turn["role"]):
            st.markdown(turn["content"])
            for step in turn.get("steps", []):
                arguments = step.arguments if isinstance(step.arguments, dict) else {"raw": step.arguments}
                with st.expander(f"Tool: {step.tool}({', '.join(f'{k}={v}' for k, v in arguments.items())})"):
                    st.json(step.result)
    cols = st.columns(len(QUESTIONS))
    preset = next((q for col, q in zip(cols, QUESTIONS) if col.button(q, use_container_width=True)), None)
    question = st.chat_input("Ask about check-in, booths or leads") or preset
    if question:
        st.session_state.chat.append({"role": "user", "content": question})
        try:
            with kimi.get_client(st.secrets.get("NEBIUS_API_KEY", "")) as client:
                model = st.session_state.get("model") or kimi.pick_model(
                    client, st.secrets.get("KIMI_MODEL", kimi.PREFERRED_MODEL)
                )
                st.session_state.model = model
                history = [{"role": t["role"], "content": t["content"]} for t in st.session_state.chat[:-1]][-6:]
                with st.spinner(f"{kimi.label(model)} is investigating…"):
                    ans = agent.ask(client, model, ev, question, history)
            st.session_state.chat.append({"role": "assistant", "content": ans.text, "steps": ans.steps})
        except Exception as err:  # show configuration and API problems in the page
            st.session_state.chat.append({"role": "assistant", "content": f"The assistant is unavailable: {err}"})
        st.session_state.drafts = ev.drafts
        st.rerun()

with right:
    st.subheader("Booths")
    st.dataframe(pd.DataFrame(health["booths"]).set_index("booth_id"), use_container_width=True)
    st.subheader("Anomalies")
    if found["anomalies"]:
        for a in found["anomalies"]:
            where = a["booth_id"] + (f" · {a['badge_id']}" if a.get("badge_id") else "")
            st.warning(f"**{a['kind'].replace('_', ' ')}** at {where} (since {a['since']})\n\n{a['explain']}")
    else:
        st.success("No open anomalies.")
    pending = [d for d in ev.drafts if d["status"] == "awaiting_approval"]
    if ev.drafts:
        st.subheader("Sponsor drafts")
    for d in ev.drafts:
        with st.container(border=True):
            st.markdown(f"**{d['subject']}**  \nTo the {d['booth_id']} sponsor · {d['status'].replace('_', ' ')}")
            st.write(d["body"])
            if d in pending and st.button("Approve", key=d["id"]):
                d["status"] = "approved"
                st.toast("Approved. This recipe doesn't send email; connect your own provider here.")
                st.rerun()
