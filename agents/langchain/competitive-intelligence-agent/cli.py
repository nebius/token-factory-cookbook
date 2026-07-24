"""CLI entry point for the competitive-intelligence agent.

Usage:
    uv run cli.py "Netflix"

This file owns the user-facing surface: argument parsing, environment checks,
live event rendering, and writing the final brief to disk. The agent itself
lives in ``agent.py``.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Annotated, Any, Iterable

import typer
from dotenv import load_dotenv
from langchain_core.messages import AIMessage, ToolMessage
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule
from rich.text import Text

from agent import build_agent

# ---------------------------------------------------------------------------
# Live stream rendering
# ---------------------------------------------------------------------------
#
# We consume LangGraph's ``stream_mode="updates"`` with ``subgraphs=True`` so
# we see activity inside sub-agents too. Each update is rendered as a single
# scrollable log line: planning, tool calls, sub-agent dispatches, and the
# final answer.

_TODO_TOOL = "write_todos"
_TASK_TOOL = "task"
_WRITE_FILE_TOOL = "write_file"

_STATUS_ICON = {"pending": "○", "in_progress": "◐", "completed": "●"}
_STATUS_STYLE = {"pending": "dim", "in_progress": "yellow", "completed": "green"}


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


def _namespace_prefix(ns: tuple[str, ...]) -> Text:
    """Render the subgraph path as a tag (e.g. ``pricing-researcher``)."""
    if not ns:
        return Text("lead", style="bold cyan")
    parts = []
    for entry in ns:
        # Entries look like 'task:pricing-researcher:abc123'.
        head = entry.split(":")
        parts.append(head[1] if len(head) >= 2 else entry)
    return Text(" → ".join(parts), style="bold magenta")


def _render_todos(console: Console, todos: list[dict[str, Any]]) -> None:
    lines = []
    for item in todos:
        status = item.get("status", "pending")
        icon = _STATUS_ICON.get(status, "?")
        style = _STATUS_STYLE.get(status, "white")
        lines.append(Text(f"  {icon} {item.get('content', '')}", style=style))
    body = Text("\n").join(lines) if lines else Text("(empty)", style="dim")
    console.print(Panel(body, title="📋 plan", border_style="blue", expand=False))


def _render_tool_call(console: Console, prefix: Text, name: str, args: dict[str, Any]) -> None:
    if name == _TODO_TOOL:
        console.print(prefix, Text("📝 plan updated", style="blue"))
        _render_todos(console, args.get("todos", []))
        return

    if name == _TASK_TOOL:
        console.print(
            prefix,
            Text("🤖 dispatch ", style="magenta"),
            Text(args.get("subagent_type", "?"), style="bold magenta"),
            Text(f"  «{_short(args.get('description', ''), 100)}»", style="dim"),
        )
        return

    if name == _WRITE_FILE_TOOL:
        path = args.get("file_path") or args.get("path") or "?"
        console.print(
            prefix,
            Text("💾 write_file ", style="green"),
            Text(path, style="bold green"),
            Text(f"  ({len(args.get('content', ''))} chars)", style="dim"),
        )
        return

    console.print(
        prefix,
        Text(f"🔧 {name}(", style="cyan"),
        Text(_format_args(args), style="cyan dim"),
        Text(")", style="cyan"),
    )


def _render_tool_result(console: Console, prefix: Text, msg: ToolMessage) -> None:
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
    """Render an agent stream; return the accumulated files + final todo list."""
    files: dict[str, Any] = {}
    todos_snapshot: list[dict[str, Any]] = []

    for event in events:
        # With subgraphs=True every yield is (namespace_tuple, update_dict).
        if isinstance(event, tuple) and len(event) == 2:
            namespace, update = event
        else:
            namespace, update = ((), event)
        prefix = _namespace_prefix(namespace)

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
                        _render_tool_call(
                            console, prefix, call.get("name", "?"), call.get("args", {}) or {}
                        )
                    text = msg.content if isinstance(msg.content, str) else ""
                    if text.strip():
                        _render_ai_text(console, prefix, text)
                elif isinstance(msg, ToolMessage):
                    _render_tool_result(console, prefix, msg)

    return {"files": files, "todos": todos_snapshot}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="Generate a competitive-intelligence brief with LangChain Deep Agents + Tavily, served by Nebius Token Factory.",
)


def _check_env(console: Console) -> None:
    missing = [k for k in ("NEBIUS_API_KEY", "TAVILY_API_KEY") if not os.getenv(k)]
    if missing:
        console.print(
            Panel(
                f"Missing environment variable(s): [bold red]{', '.join(missing)}[/].\n\n"
                "Copy [cyan]env.example[/] to [cyan].env[/] and fill in your keys, then re-run.",
                title="setup required",
                border_style="red",
            )
        )
        raise typer.Exit(code=1)


def _file_content(entry: object) -> str | None:
    """Unwrap a deep-agent virtual-FS entry into its text content.

    The Deep Agents backend stores files as
    ``{"content": str, "encoding": "utf-8", ...}`` dicts. We accept either
    that shape or a plain string.
    """
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        content = entry.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):  # legacy line-split format
            return "\n".join(content)
    return None


def _extract_brief(files: dict[str, object]) -> str | None:
    """Pull the generated brief out of the agent's virtual FS, however it's keyed."""
    for key in ("brief.md", "/brief.md"):
        if key in files:
            return _file_content(files[key])
    for key, value in files.items():
        if key.endswith("brief.md"):
            return _file_content(value)
    return None


@app.command()
def main(
    company: Annotated[
        str,
        typer.Argument(help="The company you want a competitive brief about."),
    ],
    model: Annotated[
        str,
        typer.Option(
            "--model",
            "-m",
            help="Any tool-calling capable model served by Nebius Token Factory.",
        ),
    ] = "moonshotai/Kimi-K2.5",
    output: Annotated[
        Path,
        typer.Option(
            "--output",
            "-o",
            help="Directory to write the final brief into. Defaults to ./output/.",
        ),
    ] = Path("./output"),
    recursion_limit: Annotated[
        int,
        typer.Option(help="LangGraph recursion limit. Bump if the agent runs out of steps."),
    ] = 150,
) -> None:
    """Generate a competitive-intelligence brief for COMPANY.

    The agent picks the 2-3 most relevant competitors itself, then researches
    pricing, recent activity, and sentiment for each before synthesizing a
    decision-grade brief.
    """
    load_dotenv()
    console = Console()
    _check_env(console)

    output_file = output / f"brief-{company.lower().replace(' ', '-')}.md"

    console.print(
        Panel(
            f"[bold]Company:[/] {company}\n"
            f"[bold]Model:[/]   {model} [dim](via Nebius Token Factory)[/]\n"
            f"[bold]Output:[/]  {output_file}",
            title="🛰️  competitive intelligence agent",
            border_style="cyan",
        )
    )

    user_request = (
        f"Produce a competitive-intelligence brief for {company}. "
        f"Pick the 2-3 most relevant direct competitors yourself, then follow "
        f"your process. Save the final brief to brief.md as instructed."
    )

    console.print(Rule("live agent activity", style="dim"))

    agent = build_agent(model_name=model)
    stream = agent.stream(
        {"messages": [{"role": "user", "content": user_request}]},
        config={"recursion_limit": recursion_limit},
        stream_mode="updates",
        subgraphs=True,
    )

    try:
        final = render_stream(console, stream)
    except KeyboardInterrupt:
        console.print("\n[yellow]Interrupted.[/]")
        sys.exit(130)

    console.print(Rule("brief", style="dim"))

    brief_md = _extract_brief(final["files"])
    if not brief_md:
        console.print(
            Panel(
                "The agent finished without writing [cyan]brief.md[/].\n"
                "This usually means it hit a tool-call error or ran out of recursion steps.\n"
                f"Files seen in virtual FS: {list(final['files'].keys()) or '(none)'}\n"
                "Try re-running with [cyan]--recursion-limit 250[/].",
                title="no brief produced",
                border_style="red",
            )
        )
        raise typer.Exit(code=2)

    output.mkdir(parents=True, exist_ok=True)
    output_file.write_text(brief_md, encoding="utf-8")
    console.print(Markdown(brief_md))
    console.print(Rule(style="dim"))
    console.print(f"[green]✓[/] Brief saved to [bold]{output_file}[/]")


if __name__ == "__main__":
    app()
