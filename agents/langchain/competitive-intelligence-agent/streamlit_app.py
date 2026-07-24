"""Streamlit frontend for the competitive-intelligence agent.

Run:
    streamlit run streamlit_app.py

Mirrors the CLI's streaming logic (cli.py render_stream) as a live
activity feed inside Streamlit, then renders the final brief as markdown.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from html import escape
from typing import Any, Iterable, Literal

import streamlit as st
from dotenv import load_dotenv
from langchain_core.messages import AIMessage, ToolMessage

from agent import build_agent

# ---------------------------------------------------------------------------
# Brand CSS — mirrors the voice-agent vars / look
# ---------------------------------------------------------------------------

_BRAND_CSS = """
<style>
:root {
  --ink: oklch(0.21 0.025 255);
  --muted: oklch(0.46 0.035 255);
  --soft: oklch(0.94 0.018 245);
  --paper: oklch(0.985 0.008 245);
  --line: oklch(0.86 0.022 245);
  --blue: oklch(0.48 0.16 245);
  --red: oklch(0.62 0.21 27);
  --green: oklch(0.59 0.14 155);
  --gold: oklch(0.73 0.13 88);
}

/* --- page chrome -------------------------------------------------------- */
.stApp {
  background: linear-gradient(180deg, oklch(0.97 0.012 245), oklch(0.99 0.006 245) 34rem),
              var(--paper) !important;
}
.stApp > header { background: transparent !important; }
h1, h2, h3 { color: var(--ink) !important; letter-spacing: -0.01em; }

/* --- sidebar ------------------------------------------------------------ */
section[data-testid="stSidebar"] {
  background: var(--paper) !important;
  border-right: 1px solid var(--line) !important;
}
section[data-testid="stSidebar"] .stButton > button {
  width: 100%;
  min-height: 50px;
  border: 1px solid color-mix(in oklch, var(--blue), black 8%) !important;
  border-radius: 7px !important;
  color: white !important;
  background: var(--blue) !important;
  font-weight: 800 !important;
  transition: transform 160ms ease, background 160ms ease !important;
}
section[data-testid="stSidebar"] .stButton > button:hover {
  transform: translateY(-1px) !important;
}
section[data-testid="stSidebar"] .stButton > button:disabled {
  opacity: 0.65 !important;
  cursor: wait !important;
  transform: none !important;
}

/* --- pills / status ----------------------------------------------------- */
.pill {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 14px;
  font-size: 0.82rem;
  font-weight: 750;
  text-transform: uppercase;
  background: var(--soft);
  color: var(--muted);
}
.pill.active { background: color-mix(in oklch, var(--blue), white 80%); color: var(--blue); }
.pill.done   { background: color-mix(in oklch, var(--green), white 80%); color: var(--green); }
.pill.error  { background: color-mix(in oklch, var(--red), white 80%); color: var(--red); }

/* --- activity-feed cards ------------------------------------------------ */
.ci-event {
  border: 1px solid var(--line);
  border-left: 4px solid var(--blue);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 8px;
  background: white;
  line-height: 1.55;
  font-size: 0.92rem;
}
.ci-event.lead { border-left-color: var(--blue); }
.ci-event.tool { border-left-color: var(--green); }
.ci-event.result { border-left-color: color-mix(in oklch, var(--green), black 18%); }
.ci-event.text { border-left-color: color-mix(in oklch, var(--ink), white 45%); }
.ci-event.plan { border-left-color: var(--blue); }
.ci-event.dispatch { border-left-color: var(--gold); }
.ci-event .tag {
  display: inline-block;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border-radius: 4px;
  margin-right: 8px;
}
.ci-event .tag.plan    { background: color-mix(in oklch, var(--blue), white 80%); color: var(--blue); }
.ci-event .tag.tool    { background: color-mix(in oklch, var(--green), white 80%); color: var(--green); }
.ci-event .tag.agent   { background: color-mix(in oklch, var(--gold), white 80%); color: var(--gold); }
.ci-event .tag.result  { background: var(--soft); color: var(--muted); }
.ci-event .tag.text    { background: color-mix(in oklch, var(--ink), white 90%); color: var(--ink); }

.ci-event .detail {
  color: var(--muted);
  font-size: 0.84rem;
  margin-top: 4px;
}
.ci-json {
  margin-top: 8px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: color-mix(in oklch, var(--paper), white 48%);
}
.ci-json > summary {
  cursor: pointer;
  padding: 6px 10px;
  color: var(--ink);
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.ci-json > pre {
  margin: 0;
  padding: 8px 10px 10px;
  border-top: 1px solid var(--line);
  color: var(--ink);
  font-size: 0.76rem;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: auto;
}
.ci-feed {
  min-height: 420px;
  max-height: min(78vh, 860px);
  overflow-y: auto;
  padding-right: 6px;
  overscroll-behavior-y: contain;
  scroll-behavior: smooth;
}

/* --- hierarchy timeline -------------------------------------------------- */
.ci-timeline {
  border-left: 2px solid var(--line);
  padding-left: 10px;
}
.ci-node {
  margin-left: 12px;
  padding-left: 10px;
  border-left: 1px dashed color-mix(in oklch, var(--line), var(--muted) 20%);
}
.ci-group {
  border: 1px solid var(--line);
  border-left: 4px solid var(--gold);
  border-radius: 8px;
  background: white;
  margin-bottom: 8px;
}
.ci-group > summary {
  list-style: none;
  cursor: pointer;
  padding: 12px 14px;
  font-size: 0.92rem;
  user-select: none;
}
.ci-group > summary::-webkit-details-marker { display: none; }
.ci-group > summary .caret {
  display: inline-block;
  width: 1.2rem;
  color: var(--muted);
  transition: transform 120ms ease;
}
.ci-group[open] > summary .caret { transform: rotate(90deg); }
.ci-group .group-meta {
  color: var(--muted);
  font-size: 0.83rem;
  margin-top: 4px;
}
.ci-group-body { margin: 0 12px 10px 12px; }
.status-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}
.status-dot.running { background: var(--gold); }
.status-dot.completed { background: var(--green); }
.status-dot.error { background: var(--red); }

/* --- live run dashboard ------------------------------------------------- */
.ci-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}
.ci-mini-card, .ci-side-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
}
.ci-mini-card {
  padding: 14px 16px;
}
.ci-mini-card span {
  display: block;
  color: var(--muted);
  font-size: 0.76rem;
  font-weight: 800;
  text-transform: uppercase;
}
.ci-mini-card strong {
  display: block;
  margin-top: 4px;
  color: var(--blue);
  font-size: 1.6rem;
  line-height: 1;
}
.ci-side-card {
  padding: 16px;
  margin-bottom: 14px;
}
.ci-stage-card {
  border: 1px solid color-mix(in oklch, var(--blue), white 45%);
  border-radius: 8px;
  background: color-mix(in oklch, var(--blue), white 94%);
  padding: 12px 14px;
  margin-bottom: 14px;
}
.ci-stage-label {
  color: var(--muted);
  font-size: 0.74rem;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.ci-stage-title {
  color: var(--ink);
  font-size: 1rem;
  font-weight: 850;
  margin-top: 3px;
}
.ci-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.ci-chip {
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 0.74rem;
  font-weight: 700;
  background: white;
}
.ci-chip.working {
  border-color: color-mix(in oklch, var(--gold), white 40%);
  background: color-mix(in oklch, var(--gold), white 88%);
  color: color-mix(in oklch, var(--gold), black 20%);
}
.ci-chip.complete {
  border-color: color-mix(in oklch, var(--green), white 45%);
  background: color-mix(in oklch, var(--green), white 88%);
  color: color-mix(in oklch, var(--green), black 20%);
}
.ci-recent-list {
  display: grid;
  gap: 7px;
}
.ci-recent-item {
  border-left: 3px solid var(--line);
  padding-left: 9px;
  color: var(--muted);
  font-size: 0.82rem;
}
.ci-side-title {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.ci-agent-map {
  display: grid;
  gap: 10px;
}
.ci-node-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 10px;
  align-items: start;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 10px 12px;
  background: color-mix(in oklch, var(--paper), white 44%);
}
.ci-node-row.lead {
  border-color: color-mix(in oklch, var(--blue), white 50%);
  background: color-mix(in oklch, var(--blue), white 92%);
}
.ci-node-name {
  color: var(--ink);
  font-weight: 800;
}
.ci-node-last {
  color: var(--muted);
  font-size: 0.82rem;
  margin-top: 2px;
}
.ci-status {
  border-radius: 999px;
  padding: 3px 9px;
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;
  white-space: nowrap;
}
.ci-status.running, .ci-status.working, .ci-status.dispatched {
  background: color-mix(in oklch, var(--gold), white 80%);
  color: var(--gold);
}
.ci-status.reported, .ci-status.complete {
  background: color-mix(in oklch, var(--green), white 80%);
  color: var(--green);
}
.ci-delegation {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  align-items: start;
  border-left: 3px solid var(--blue);
  padding: 8px 0 8px 10px;
}
.ci-delegation strong { color: var(--ink); }
.ci-delegation div { color: var(--muted); font-size: 0.82rem; }
.ci-arrow { color: var(--blue); font-weight: 900; }

@media (max-width: 860px) {
  .ci-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* --- plan dots ---------------------------------------------------------- */
.ci-plan-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 3px 0;
  font-size: 0.9rem;
}
.ci-plan-item .dot {
  flex-shrink: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid var(--line);
}
.ci-plan-item .dot.pending     { border-color: var(--muted); }
.ci-plan-item .dot.in_progress { border-color: var(--gold);  background: var(--gold); }
.ci-plan-item .dot.completed   { border-color: var(--green); background: var(--green); }
.ci-progress {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: white;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.ci-progress .bar {
  height: 8px;
  background: var(--soft);
  border-radius: 999px;
  overflow: hidden;
  margin-top: 8px;
}
.ci-progress .bar > span {
  display: block;
  height: 100%;
  width: 0%;
  background: var(--blue);
}

/* --- brief output ------------------------------------------------------- */
.ci-brief {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 28px 32px;
  background: white;
}
.ci-brief h1 { font-size: 1.6rem !important; }
.ci-brief h2 { font-size: 1.25rem !important; margin-top: 1.4em !important; }
.ci-brief h3 { font-size: 1.05rem !important; }
.ci-brief table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.ci-brief th, .ci-brief td {
  border: 1px solid var(--line);
  padding: 8px 12px;
  text-align: left;
}
.ci-brief th {
  background: var(--soft);
  font-weight: 700;
}

/* --- eyebrow ------------------------------------------------------------ */
.eyebrow {
  color: var(--blue);
  font-size: 0.78rem;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 6px;
}

/* hide Streamlit default footer + hamburger */
#stDecoration, footer { display: none !important; }
</style>
"""

# ---------------------------------------------------------------------------
# Constants (shared with cli.py)
# ---------------------------------------------------------------------------

_TODO_TOOL = "write_todos"
_TASK_TOOL = "task"
_WRITE_FILE_TOOL = "write_file"
_TAVILY_LOGO_URL = "https://www.tavily.com/logos/tavily-full.svg"

_STATUS_ICON = {"pending": "○", "in_progress": "◐", "completed": "●"}


def _short(text: str, limit: int = 240) -> str:
    text = text.strip().replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _format_args(args: dict[str, Any]) -> str:
    if not args:
        return ""
    parts = []
    for key, value in args.items():
        if isinstance(value, str):
            parts.append(f"{key}={json.dumps(_short(value, 80))}")
        elif isinstance(value, (list, dict)):
            parts.append(f"{key}={_short(json.dumps(value, default=str), 80)}")
        else:
            parts.append(f"{key}={value!r}")
    return ", ".join(parts)


def _try_parse_json(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    s = value.strip()
    if not s or s[0] not in "{[":
        return value
    try:
        return json.loads(s)
    except Exception:
        return value


def _json_viewer_html(
    title: str, payload: Any, open_by_default: bool = False, max_chars: int = 7000
) -> str:
    parsed = _try_parse_json(payload)
    try:
        pretty = json.dumps(parsed, indent=2, default=str)
    except Exception:
        pretty = str(payload)
    if len(pretty) > max_chars:
        pretty = pretty[: max_chars - 1] + "…"
    open_attr = " open" if open_by_default else ""
    return (
        f'<details class="ci-json"{open_attr}>'
        f"<summary>{escape(title)}</summary>"
        f"<pre>{escape(pretty)}</pre>"
        "</details>"
    )


def _file_content(entry: object) -> str | None:
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        content = entry.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            return "\n".join(content)
    return None


def _extract_brief(files: dict[str, object]) -> str | None:
    for key in ("brief.md", "/brief.md"):
        if key in files:
            return _file_content(files[key])
    for key, value in files.items():
        if key.endswith("brief.md"):
            return _file_content(value)
    return None


# ---------------------------------------------------------------------------
# HTML helpers for Streamlit
# ---------------------------------------------------------------------------


def _html_plan_rows(todos: list[dict[str, Any]]) -> str:
    rows = []
    for item in todos:
        status = escape(str(item.get("status", "pending")))
        content = escape(str(item.get("content", "")))
        rows.append(
            f'<div class="ci-plan-item">'
            f'<span class="dot {status}"></span>'
            f"<span>{content}</span>"
            f"</div>"
        )
    return (
        "\n".join(rows)
        if rows
        else '<div class="detail">Waiting for the lead agent to plan…</div>'
    )


def _html_plan(todos: list[dict[str, Any]]) -> str:
    return (
        f'<div class="ci-event">'
        f'<span class="tag plan">plan</span> 📋 plan updated'
        f'<div class="detail">{_html_plan_rows(todos)}</div>'
        f"</div>"
    )


def _html_plan_panel(todos: list[dict[str, Any]]) -> str:
    return (
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Plan</div>'
        f"{_html_plan_rows(todos)}"
        "</div>"
    )


def _html_metric_grid(stats: dict[str, int]) -> str:
    return (
        '<div class="ci-metric-grid">'
        f'<div class="ci-mini-card"><span>Events</span><strong>{stats["events"]}</strong></div>'
        f'<div class="ci-mini-card"><span>Tool calls</span><strong>{stats["tools"]}</strong></div>'
        f'<div class="ci-mini-card"><span>Delegations</span><strong>{stats["delegations"]}</strong></div>'
        f'<div class="ci-mini-card"><span>Files</span><strong>{stats["files"]}</strong></div>'
        "</div>"
    )


def _infer_stage(
    todos: list[dict[str, Any]], delegations: list[dict[str, Any]]
) -> tuple[str, str]:
    if not todos and not delegations:
        return ("Initializing run", "Setting up lead agent and first tools.")
    if any(item.get("status") == "in_progress" for item in todos):
        active = next(
            (
                _short(str(item.get("content", "")), 80)
                for item in todos
                if item.get("status") == "in_progress"
            ),
            "Executing plan",
        )
        return ("Executing plan", active)
    if todos and all(item.get("status") == "completed" for item in todos):
        return ("Composing final brief", "Research complete, writing synthesis.")
    return ("Sub-agent research", "Delegating and collecting evidence.")


def _html_mission_panel(
    agents: dict[str, dict[str, Any]],
    delegations: list[dict[str, Any]],
    todos: list[dict[str, Any]],
    recent_titles: list[str],
) -> str:
    stage, stage_detail = _infer_stage(todos, delegations)
    active_chips = []
    done_chips = []
    for name, meta in agents.items():
        status = escape(str(meta.get("status", "running")))
        chip = f'<span class="ci-chip {"complete" if status in {"complete", "reported"} else "working"}">{escape(name)} · {status}</span>'
        if status in {"complete", "reported"}:
            done_chips.append(chip)
        else:
            active_chips.append(chip)

    delegation_rows = []
    for item in delegations[-10:]:
        delegation_rows.append(
            '<div class="ci-delegation">'
            '<div class="ci-arrow">lead →</div>'
            f"<div><strong>{escape(str(item['to']))}</strong>"
            f"<div>{escape(_short(str(item.get('description', '')), 110))}</div></div>"
            "</div>"
        )

    delegation_html = (
        "".join(delegation_rows)
        if delegation_rows
        else '<div class="detail">No handoffs yet.</div>'
    )
    recent_html = (
        "".join(
            f'<div class="ci-recent-item">{escape(title)}</div>'
            for title in recent_titles[-8:]
        )
        if recent_titles
        else '<div class="detail">Waiting for first event…</div>'
    )
    active_html = (
        "".join(active_chips)
        if active_chips
        else '<span class="detail">No active agents</span>'
    )
    done_html = (
        "".join(done_chips) if done_chips else '<span class="detail">None yet</span>'
    )

    return (
        '<div class="ci-stage-card">'
        '<div class="ci-stage-label">Current stage</div>'
        f'<div class="ci-stage-title">{escape(stage)}</div>'
        f'<div class="ci-node-last">{escape(stage_detail)}</div>'
        "</div>"
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Active agents</div>'
        '<div class="ci-chip-row">'
        f"{active_html}"
        "</div>"
        "</div>"
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Recent handoffs</div>'
        f"{delegation_html}"
        "</div>"
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Recent activity</div>'
        f'<div class="ci-recent-list">{recent_html}</div>'
        "</div>"
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Completed agents</div>'
        '<div class="ci-chip-row">'
        f"{done_html}"
        "</div>"
        "</div>"
    )


def _html_tool_call(namespace: str, name: str, args: dict[str, Any]) -> str:
    if name == _TODO_TOOL:
        return _html_plan(args.get("todos", []))

    if name == _TASK_TOOL:
        agent_type = escape(str(args.get("subagent_type", "?")))
        desc = escape(_short(str(args.get("description", "")), 100))
        return (
            f'<div class="ci-event">'
            f'<span class="tag agent">{escape(namespace)}</span> 🤖 dispatch '
            f"<strong>{agent_type}</strong>  «{desc}»"
            f"</div>"
        )

    if name == _WRITE_FILE_TOOL:
        path = escape(str(args.get("file_path") or args.get("path") or "?"))
        size = len(args.get("content", ""))
        return (
            f'<div class="ci-event">'
            f'<span class="tag tool">{escape(namespace)}</span> 💾 write_file '
            f"<strong>{path}</strong>  ({size} chars)"
            f"</div>"
        )

    formatted = escape(_format_args(args))
    return (
        f'<div class="ci-event">'
        f'<span class="tag tool">{escape(namespace)}</span> 🔧 {escape(name)}({formatted})'
        f"</div>"
    )


def _html_tool_result(namespace: str, name: str, content: str) -> str:
    return (
        f'<div class="ci-event">'
        f'<span class="tag result">{escape(namespace)}</span> ↳ {escape(name)}: {escape(_short(content, 200))}'
        f"</div>"
    )


def _html_ai_text(namespace: str, text: str) -> str:
    return (
        f'<div class="ci-event">'
        f'<span class="tag text">{escape(namespace)}</span> 💬 {escape(_short(text, 400))}'
        f"</div>"
    )


def _namespace_label(ns: tuple[str, ...]) -> str:
    if not ns:
        return "lead"
    parts = []
    for entry in ns:
        head = entry.split(":")
        parts.append(head[1] if len(head) >= 2 else entry)
    return " → ".join(parts)


@dataclass
class TimelineEvent:
    category: Literal["lead", "tool", "result", "text", "plan", "dispatch"]
    tag: str
    headline: str
    detail_html: str = ""


@dataclass
class SubagentGroup:
    namespace: tuple[str, ...]
    name: str
    parent: tuple[str, ...]
    status: Literal["running", "completed", "error"] = "running"
    description: str = ""
    children: list[TimelineEvent | "SubagentGroup"] = field(default_factory=list)


class TimelineState:
    def __init__(self) -> None:
        self.root_items: list[TimelineEvent | SubagentGroup] = []
        self.group_by_namespace: dict[tuple[str, ...], SubagentGroup] = {}
        self.pending_dispatch: dict[tuple[tuple[str, ...], str], list[str]] = {}

    @staticmethod
    def _parse_ns_entry(entry: str) -> tuple[str, str, str]:
        parts = entry.split(":")
        if len(parts) >= 3:
            return parts[0], parts[1], parts[2]
        if len(parts) == 2:
            return parts[0], parts[1], ""
        return "task", entry, ""

    def _ensure_group(self, namespace: tuple[str, ...]) -> SubagentGroup:
        existing = self.group_by_namespace.get(namespace)
        if existing:
            return existing

        parent_ns = namespace[:-1]
        _kind, name, _run_id = self._parse_ns_entry(namespace[-1])
        group = SubagentGroup(namespace=namespace, name=name, parent=parent_ns)

        pending_key = (parent_ns, name)
        if pending_key in self.pending_dispatch and self.pending_dispatch[pending_key]:
            group.description = self.pending_dispatch[pending_key].pop(0)

        if parent_ns:
            self._ensure_group(parent_ns).children.append(group)
        else:
            self.root_items.append(group)

        self.group_by_namespace[namespace] = group
        return group

    def add_event(self, namespace: tuple[str, ...], event: TimelineEvent) -> None:
        if not namespace:
            self.root_items.append(event)
            return
        self._ensure_group(namespace).children.append(event)

    def register_dispatch(
        self, namespace: tuple[str, ...], subagent_type: str, description: str
    ) -> None:
        key = (namespace, subagent_type)
        self.pending_dispatch.setdefault(key, []).append(description)

    def mark_running(self, namespace: tuple[str, ...]) -> None:
        if namespace:
            self._ensure_group(namespace).status = "running"

    def mark_error(self, namespace: tuple[str, ...]) -> None:
        if namespace:
            self._ensure_group(namespace).status = "error"

    def finalize(self) -> None:
        for group in self.group_by_namespace.values():
            if group.status == "running":
                group.status = "completed"


def _plan_progress(todos: list[dict[str, Any]]) -> tuple[int, int, int]:
    total = len(todos)
    completed = sum(1 for item in todos if item.get("status") == "completed")
    percent = int((completed / total) * 100) if total else 0
    return completed, total, percent


def _html_sidebar_plan(todos: list[dict[str, Any]]) -> str:
    completed, total, percent = _plan_progress(todos)
    return (
        '<div class="ci-side-card">'
        '<div class="ci-side-title">Plan progress</div>'
        f'<div class="ci-progress"><strong>{completed}/{total} done</strong>'
        f'<div class="bar"><span style="width: {percent}%;"></span></div></div>'
        f"{_html_plan_rows(todos)}"
        "</div>"
    )


def _tag_class(category: str) -> str:
    if category in {"dispatch", "lead"}:
        return "agent"
    return category


def _event_html(event: TimelineEvent) -> str:
    detail = (
        f'<div class="detail">{event.detail_html}</div>' if event.detail_html else ""
    )
    return (
        f'<div class="ci-event {event.category}">'
        f'<span class="tag {_tag_class(event.category)}">{escape(event.tag)}</span> '
        f"{escape(event.headline)}"
        f"{detail}"
        f"</div>"
    )


def _group_html(group: SubagentGroup) -> str:
    pill_cls = (
        "active"
        if group.status == "running"
        else ("done" if group.status == "completed" else "error")
    )
    summary = (
        f'<span class="caret">▶</span>'
        f'<span class="status-dot {group.status}"></span>'
        f"<strong>{escape(group.name)}</strong> "
        f'<span class="pill {pill_cls}">{escape(group.status)}</span>'
    )
    if group.description:
        summary += (
            f'<div class="group-meta">{escape(_short(group.description, 220))}</div>'
        )

    child_html = []
    for child in group.children:
        if isinstance(child, SubagentGroup):
            child_html.append(_group_html(child))
        else:
            child_html.append(_event_html(child))

    body = (
        "\n".join(child_html)
        if child_html
        else '<div class="detail">(no activity yet)</div>'
    )
    open_attr = " open" if group.status == "running" else ""
    return (
        f'<details class="ci-group"{open_attr}>'
        f"<summary>{summary}</summary>"
        f'<div class="ci-group-body ci-node">{body}</div>'
        "</details>"
    )


def _timeline_html(state: TimelineState) -> str:
    out = ['<div class="ci-timeline">']
    for item in state.root_items:
        if isinstance(item, SubagentGroup):
            out.append(_group_html(item))
        else:
            out.append(_event_html(item))
    out.append("</div>")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# Stream consumer — yields HTML fragments for each event
# ---------------------------------------------------------------------------


def consume_stream(events: Iterable[Any]):
    """Consume the LangGraph stream, yielding (event_info, state_dict) pairs."""
    files: dict[str, Any] = {}
    todos_snapshot: list[dict[str, Any]] = []

    for event in events:
        if isinstance(event, tuple) and len(event) == 2:
            namespace, update = event
        else:
            namespace, update = ((), event)

        ns_label = _namespace_label(namespace)

        for _node_name, partial in update.items():
            if not isinstance(partial, dict):
                continue

            if isinstance(partial.get("files"), dict):
                files.update(partial["files"])
            if isinstance(partial.get("todos"), list):
                todos_snapshot = partial["todos"]

            for msg in partial.get("messages", []) or []:
                if isinstance(msg, AIMessage):
                    for call in getattr(msg, "tool_calls", []) or []:
                        tool_name = call.get("name", "?")
                        tool_args = call.get("args", {}) or {}
                        yield (
                            {
                                "kind": "delegation"
                                if tool_name == _TASK_TOOL
                                else "tool",
                                "namespace": ns_label,
                                "namespace_tuple": namespace,
                                "tool": tool_name,
                                "args": tool_args,
                                "title": f"called {tool_name}",
                            },
                            {"files": dict(files), "todos": list(todos_snapshot)},
                        )
                    text = msg.content if isinstance(msg.content, str) else ""
                    if text.strip():
                        yield (
                            {
                                "kind": "text",
                                "namespace": ns_label,
                                "namespace_tuple": namespace,
                                "text": text,
                                "title": _short(text, 80),
                            },
                            {"files": dict(files), "todos": list(todos_snapshot)},
                        )
                elif isinstance(msg, ToolMessage):
                    name = getattr(msg, "name", "tool")
                    content = (
                        msg.content
                        if isinstance(msg.content, str)
                        else json.dumps(msg.content, default=str)
                    )
                    yield (
                        {
                            "kind": "result",
                            "namespace": ns_label,
                            "namespace_tuple": namespace,
                            "tool": name,
                            "content": content,
                            "title": f"{name} returned",
                        },
                        {"files": dict(files), "todos": list(todos_snapshot)},
                    )

    # final yield so caller gets the last state even if no messages
    yield None, {"files": dict(files), "todos": list(todos_snapshot)}


# ---------------------------------------------------------------------------
# Streamlit app
# ---------------------------------------------------------------------------

st.set_page_config(
    page_title="Competitive Intelligence Agent",
    page_icon="🛰️",
    layout="wide",
    initial_sidebar_state="expanded",
)
st.markdown(_BRAND_CSS, unsafe_allow_html=True)

# -- sidebar ---------------------------------------------------------------

with st.sidebar:
    st.markdown(
        '<p class="eyebrow">Nebius Token Factory + Tavily</p>', unsafe_allow_html=True
    )
    st.markdown("## 🛰️ Competitive Intelligence")

    company = st.text_input(
        "Company",
        placeholder="e.g. Netflix, Linear, Vercel",
        help="The company you want a competitive brief about.",
    )

    model = st.text_input(
        "Model",
        value="moonshotai/Kimi-K2.5",
        help="Any tool-calling capable model served by Nebius Token Factory.",
    )

    recursion_limit = st.slider(
        "Recursion limit",
        min_value=50,
        max_value=300,
        value=150,
        step=25,
        help="Bump if the agent runs out of LangGraph steps.",
    )

    run_btn = st.button(
        "🚀  Generate Brief", disabled=(not company), use_container_width=True
    )

    if run_btn and company:
        st.session_state["run_trigger"] = {
            "company": company,
            "model": model,
            "recursion_limit": recursion_limit,
        }

# -- main area -------------------------------------------------------------
hero_left, hero_right = st.columns([0.14, 0.86], gap="small")
with hero_left:
    st.image(_TAVILY_LOGO_URL, width=100)
with hero_right:
    st.markdown(
        '<p class="eyebrow">Competitive Intelligence Agent</p>', unsafe_allow_html=True
    )
    st.markdown("# Decision-grade competitive briefs")
st.markdown(
    "Give it a company name. It picks the top competitors itself, researches each "
    "across **pricing**, **recent activity**, and **sentiment**, then synthesizes "
    "a strategic brief — powered by LangChain Deep Agents + Tavily + Nebius Token Factory."
)
st.markdown("---")

# Check env on first load
load_dotenv()
_missing_env = [k for k in ("NEBIUS_API_KEY", "TAVILY_API_KEY") if not os.getenv(k)]
if _missing_env:
    st.error(
        f"Missing environment variable(s): **{', '.join(_missing_env)}**.  \n"
        "Copy `env.example` to `.env` and fill in your keys, then restart.",
        icon="🔑",
    )
    st.stop()

# -- run the agent ---------------------------------------------------------

trigger = st.session_state.get("run_trigger")

if trigger:
    cfg = trigger
    del st.session_state["run_trigger"]

    st.markdown('<p class="eyebrow">Execution workspace</p>', unsafe_allow_html=True)

    # Status pill
    status_placeholder = st.empty()
    status_placeholder.markdown(
        '<span class="pill active">● Running</span>', unsafe_allow_html=True
    )

    overview_tab, timeline_tab, output_tab = st.tabs(
        ["Overview", "Execution Timeline", "Output"]
    )

    with timeline_tab:
        st.markdown("### Execution timeline")
        feed_placeholder = st.empty()
    with overview_tab:
        st.markdown("### Mission control")
        mission_panel_placeholder = st.empty()
        plan_panel_placeholder = st.empty()
    with output_tab:
        st.markdown("### Generated brief")
        brief_container = st.container()

    timeline_state = TimelineState()
    agents: dict[str, dict[str, Any]] = {
        "lead": {
            "status": "running",
            "last": "Initializing competitive brief",
            "events": 0,
        }
    }
    delegations: list[dict[str, Any]] = []
    pending_delegations: list[str] = []
    recent_titles: list[str] = []
    final_state = {"files": {}, "todos": []}

    def refresh_side_panels() -> None:
        mission_panel_placeholder.markdown(
            _html_mission_panel(
                agents,
                delegations,
                final_state.get("todos", []),
                recent_titles,
            ),
            unsafe_allow_html=True,
        )
        plan_panel_placeholder.markdown(
            _html_sidebar_plan(final_state.get("todos", [])), unsafe_allow_html=True
        )

    refresh_side_panels()

    user_request = (
        f"Produce a competitive-intelligence brief for {cfg['company']}. "
        f"Pick the 2-3 most relevant direct competitors yourself, then follow "
        f"your process. Save the final brief to brief.md as instructed."
    )

    try:
        agent = build_agent(model_name=cfg["model"])
        stream = agent.stream(
            {"messages": [{"role": "user", "content": user_request}]},
            config={"recursion_limit": cfg["recursion_limit"]},
            stream_mode="updates",
            subgraphs=True,
        )

        for event_info, state in consume_stream(stream):
            if state:
                final_state = state

            if event_info:
                namespace = event_info.get("namespace", "lead")
                namespace_tuple = tuple(event_info.get("namespace_tuple", ()))
                agent_name = namespace.split(" → ")[-1]
                agents.setdefault(
                    agent_name,
                    {"status": "working", "last": "Starting", "events": 0},
                )
                agents[agent_name]["events"] += 1
                agents[agent_name]["last"] = event_info.get("title", "Working")
                recent_titles.append(str(event_info.get("title", "Working")))
                if len(recent_titles) > 40:
                    recent_titles = recent_titles[-40:]
                if agent_name != "lead":
                    agents[agent_name]["status"] = "working"
                if namespace_tuple:
                    timeline_state.mark_running(namespace_tuple)

                if event_info.get("kind") == "tool":
                    tool_name = str(event_info.get("tool", "tool"))
                    tool_args = event_info.get("args", {}) or {}
                    if tool_name == _TODO_TOOL:
                        timeline_state.add_event(
                            namespace_tuple,
                            TimelineEvent(
                                category="plan",
                                tag="plan",
                                headline="plan updated",
                                detail_html=(
                                    _html_plan_rows(tool_args.get("todos", []))
                                    + _json_viewer_html("tool args", tool_args)
                                ),
                            ),
                        )
                    elif tool_name == _WRITE_FILE_TOOL:
                        path = str(
                            tool_args.get("file_path") or tool_args.get("path") or "?"
                        )
                        size = len(str(tool_args.get("content", "")))
                        timeline_state.add_event(
                            namespace_tuple,
                            TimelineEvent(
                                category="tool",
                                tag=namespace,
                                headline=f"write_file {path} ({size} chars)",
                                detail_html=_json_viewer_html("tool args", tool_args),
                            ),
                        )
                    else:
                        timeline_state.add_event(
                            namespace_tuple,
                            TimelineEvent(
                                category="tool",
                                tag=namespace,
                                headline=f"{tool_name} called",
                                detail_html=_json_viewer_html("tool args", tool_args),
                            ),
                        )
                elif event_info.get("kind") == "delegation":
                    args = event_info.get("args", {})
                    subagent = str(args.get("subagent_type", "subagent"))
                    desc = str(args.get("description", ""))
                    timeline_state.register_dispatch(namespace_tuple, subagent, desc)
                    timeline_state.add_event(
                        namespace_tuple,
                        TimelineEvent(
                            category="dispatch",
                            tag=namespace,
                            headline=f"dispatch {subagent}",
                            detail_html=escape(_short(desc, 220)),
                        ),
                    )
                    delegations.append(
                        {"to": subagent, "description": desc, "status": "dispatched"}
                    )
                    pending_delegations.append(subagent)
                    agents.setdefault(
                        subagent,
                        {"status": "dispatched", "last": "Queued by lead", "events": 0},
                    )
                    agents[subagent]["status"] = "dispatched"
                    agents[subagent]["last"] = _short(desc, 80) or "Queued by lead"
                elif (
                    event_info.get("kind") == "result"
                    and event_info.get("tool") == _TASK_TOOL
                ):
                    timeline_state.add_event(
                        namespace_tuple,
                        TimelineEvent(
                            category="result",
                            tag=namespace,
                            headline="task returned",
                            detail_html=_json_viewer_html(
                                "tool result", str(event_info.get("content", ""))
                            ),
                        ),
                    )
                    if pending_delegations:
                        completed = pending_delegations.pop(0)
                        if completed in agents:
                            agents[completed]["status"] = "reported"
                            agents[completed]["last"] = "Report returned to lead"
                elif event_info.get("kind") == "result":
                    timeline_state.add_event(
                        namespace_tuple,
                        TimelineEvent(
                            category="result",
                            tag=namespace,
                            headline=f"{event_info.get('tool', 'tool')} returned",
                            detail_html=_json_viewer_html(
                                "tool result", str(event_info.get("content", ""))
                            ),
                        ),
                    )
                elif event_info.get("kind") == "text":
                    timeline_state.add_event(
                        namespace_tuple,
                        TimelineEvent(
                            category="text",
                            tag=namespace,
                            headline=_short(str(event_info.get("text", "")), 240),
                        ),
                    )

                feed_placeholder.markdown(
                    '<div class="ci-feed">' + _timeline_html(timeline_state) + "</div>",
                    unsafe_allow_html=True,
                )
                refresh_side_panels()

        timeline_state.finalize()
        feed_placeholder.markdown(
            '<div class="ci-feed">' + _timeline_html(timeline_state) + "</div>",
            unsafe_allow_html=True,
        )
        for meta in agents.values():
            if meta.get("status") in {"running", "working", "dispatched", "reported"}:
                meta["status"] = "complete"
        refresh_side_panels()

        # Done — show brief
        brief_md = _extract_brief(final_state["files"])

        if brief_md:
            status_placeholder.markdown(
                '<span class="pill done">✓ Complete</span>', unsafe_allow_html=True
            )
            with output_tab:
                st.success("Brief ready. Open this tab to review and download.")
            with brief_container:
                st.markdown('<p class="eyebrow">Generated Brief</p>', unsafe_allow_html=True)
                st.markdown('<div class="ci-brief">', unsafe_allow_html=True)
                st.markdown(brief_md)
                st.markdown("</div>", unsafe_allow_html=True)
            with output_tab:
                st.download_button(
                    "📥 Download brief.md",
                    data=brief_md,
                    file_name=f"brief-{cfg['company'].lower().replace(' ', '-')}.md",
                    mime="text/markdown",
                    use_container_width=True,
                )
        else:
            status_placeholder.markdown(
                '<span class="pill error">✗ No brief</span>', unsafe_allow_html=True
            )
            file_keys = list(final_state["files"].keys()) or ["(none)"]
            st.warning(
                "The agent finished without writing `brief.md`.  \n"
                "This usually means it hit a tool-call error or ran out of recursion steps.  \n"
                f"Files seen in virtual FS: {', '.join(file_keys)}  \n"
                "Try re-running with a higher recursion limit.",
                icon="⚠️",
            )

    except Exception as exc:
        status_placeholder.markdown(
            '<span class="pill error">✗ Error</span>', unsafe_allow_html=True
        )
        st.error(f"Agent failed: {exc}", icon="🚨")
else:
    # Empty state
    st.info(
        "Enter a company name in the sidebar and click **Generate Brief** to start.",
        icon="👈",
    )
