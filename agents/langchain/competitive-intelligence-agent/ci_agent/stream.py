"""Live rendering of deep-agent stream events with `rich`.

We consume LangGraph's ``stream_mode="updates"`` with ``subgraphs=True`` so we
see activity inside sub-agents too. Each update is rendered as a single, scrollable
log line: the agent's planning, every tool call, every sub-agent dispatch,
and the final answer.
"""

from __future__ import annotations

import json
from typing import Any, Iterable

from langchain_core.messages import AIMessage, ToolMessage
from rich.console import Console
from rich.panel import Panel
from rich.text import Text

# Tool calls we render with custom formatting; everything else falls through
# to a generic "🔧 tool_name(args)" line.
_TODO_TOOL = "write_todos"
_TASK_TOOL = "task"
_WRITE_FILE_TOOL = "write_file"

_STATUS_ICON = {
    "pending": "○",
    "in_progress": "◐",
    "completed": "●",
}
_STATUS_STYLE = {
    "pending": "dim",
    "in_progress": "yellow",
    "completed": "green",
}


def _short(text: str, limit: int = 240) -> str:
    text = text.strip().replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _format_args(args: dict[str, Any]) -> str:
    """Compact one-line repr of tool call arguments."""
    if not args:
        return ""
    parts = []
    for key, value in args.items():
        if isinstance(value, str):
            parts.append(f"{key}={json.dumps(_short(value, 80))}")
        elif isinstance(value, (list, dict)):
            blob = json.dumps(value, default=str)
            parts.append(f"{key}={_short(blob, 80)}")
        else:
            parts.append(f"{key}={value!r}")
    return ", ".join(parts)


def _namespace_prefix(ns: tuple[str, ...]) -> Text:
    """Render the subgraph path as a tag, e.g. ``[task:pricing-researcher]``."""
    if not ns:
        return Text("lead", style="bold cyan")
    # ns entries look like 'task:pricing-researcher:abc123'. Keep the readable bit.
    parts = []
    for entry in ns:
        head = entry.split(":")
        if len(head) >= 2:
            parts.append(head[1])
        else:
            parts.append(entry)
    return Text(" → ".join(parts), style="bold magenta")


def _render_todos(console: Console, todos: list[dict[str, Any]]) -> None:
    lines = []
    for item in todos:
        status = item.get("status", "pending")
        icon = _STATUS_ICON.get(status, "?")
        style = _STATUS_STYLE.get(status, "white")
        content = item.get("content", "")
        lines.append(Text(f"  {icon} {content}", style=style))
    body = Text("\n").join(lines) if lines else Text("(empty)", style="dim")
    console.print(Panel(body, title="📋 plan", border_style="blue", expand=False))


def _render_tool_call(
    console: Console,
    prefix: Text,
    name: str,
    args: dict[str, Any],
) -> None:
    if name == _TODO_TOOL:
        # Render the plan separately for readability.
        todos = args.get("todos", [])
        console.print(prefix, Text("📝 plan updated", style="blue"))
        _render_todos(console, todos)
        return

    if name == _TASK_TOOL:
        sub = args.get("subagent_type", "?")
        desc = _short(args.get("description", ""), 100)
        console.print(
            prefix,
            Text("🤖 dispatch ", style="magenta"),
            Text(sub, style="bold magenta"),
            Text(f"  «{desc}»", style="dim"),
        )
        return

    if name == _WRITE_FILE_TOOL:
        path = args.get("file_path") or args.get("path") or "?"
        content = args.get("content", "")
        console.print(
            prefix,
            Text("💾 write_file ", style="green"),
            Text(path, style="bold green"),
            Text(f"  ({len(content)} chars)", style="dim"),
        )
        return

    # Generic tool call.
    console.print(
        prefix,
        Text(f"🔧 {name}(", style="cyan"),
        Text(_format_args(args), style="cyan dim"),
        Text(")", style="cyan"),
    )


def _render_tool_result(
    console: Console,
    prefix: Text,
    msg: ToolMessage,
) -> None:
    name = getattr(msg, "name", "tool")
    content = msg.content if isinstance(msg.content, str) else json.dumps(msg.content, default=str)
    console.print(
        prefix,
        Text(f"   ↳ {name}: ", style="dim cyan"),
        Text(_short(content, 200), style="dim"),
    )


def _render_ai_text(console: Console, prefix: Text, content: str) -> None:
    console.print(prefix, Text("💬 ", style="yellow"), Text(_short(content, 400), style="yellow"))


def render_stream(console: Console, events: Iterable[Any]) -> dict[str, Any]:
    """Render an agent stream and return the final state-shaped accumulator.

    The agent's final ``state["files"]`` dict is reconstructed from the updates
    so we can recover the generated ``brief.md`` without a second invocation.
    """
    files: dict[str, Any] = {}
    todos_snapshot: list[dict[str, Any]] = []

    for event in events:
        # With subgraphs=True, every yield is (namespace_tuple, update_dict).
        if isinstance(event, tuple) and len(event) == 2:
            namespace, update = event
        else:
            namespace, update = ((), event)
        prefix = _namespace_prefix(namespace)

        # ``update`` is {node_name: state_partial} — we don't care about node
        # names, only the state deltas.
        for _node_name, partial in update.items():
            if not isinstance(partial, dict):
                continue

            # New files from write_file.
            if "files" in partial and isinstance(partial["files"], dict):
                files.update(partial["files"])

            # Todo-list snapshot (top-level state field).
            if "todos" in partial and isinstance(partial["todos"], list):
                todos_snapshot = partial["todos"]

            # New messages — render every AI/Tool message.
            for msg in partial.get("messages", []) or []:
                if isinstance(msg, AIMessage):
                    # Tool calls (zero or more).
                    for call in getattr(msg, "tool_calls", []) or []:
                        _render_tool_call(
                            console,
                            prefix,
                            call.get("name", "?"),
                            call.get("args", {}) or {},
                        )
                    # Free-text AI content (rare during tool loops, common at the end).
                    text = msg.content if isinstance(msg.content, str) else ""
                    if text.strip():
                        _render_ai_text(console, prefix, text)
                elif isinstance(msg, ToolMessage):
                    _render_tool_result(console, prefix, msg)

    return {"files": files, "todos": todos_snapshot}
