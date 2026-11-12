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
from utils import (
    extract_brief as _extract_brief,
    format_args as _format_args,
    namespace_label as _namespace_label,
    normalize_todos as _normalize_todos,
    normalize_tool_args as _normalize_tool_args,
    recover_inline_write_file as _recover_inline_write_file,
    short_text as _short,
)

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


def _namespace_prefix(ns: tuple[str, ...]) -> Text:
    """Render the subgraph path as a tag (e.g. ``pricing-researcher``)."""
    return Text(_namespace_label(ns), style="bold magenta" if ns else "bold cyan")


def _render_todos(console: Console, todos: Any) -> None:
    """Render todo arguments without assuming the model emitted valid schema data.

    Tool calls are streamed before Deep Agents validates them. Some providers can
    therefore briefly emit a JSON string, a single object, or a list of strings
    instead of the declared ``list[Todo]`` shape. The tool layer can ask the model
    to correct invalid input; the progress renderer should never terminate the run.
    """
    lines = []
    for item in _normalize_todos(todos):
        status = item["status"]
        content = item["content"]
        icon = _STATUS_ICON.get(status, "?")
        style = _STATUS_STYLE.get(status, "white")
        lines.append(Text(f"  {icon} {content}", style=style))
    body = Text("\n").join(lines) if lines else Text("(empty)", style="dim")
    console.print(Panel(body, title="📋 plan", border_style="blue", expand=False))


def _render_tool_call(console: Console, prefix: Text, name: str, args: Any) -> None:
    args = _normalize_tool_args(args)

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
            Text(f"  ({len(str(args.get('content', '')))} chars)", style="dim"),
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
        if not isinstance(update, dict):
            continue
        prefix = _namespace_prefix(namespace)

        for _node_name, partial in update.items():
            if not isinstance(partial, dict):
                continue

            if isinstance(partial.get("files"), dict):
                files.update(partial["files"])
            if "todos" in partial:
                todos_snapshot = _normalize_todos(partial["todos"])

            for msg in partial.get("messages", []) or []:
                if isinstance(msg, AIMessage):
                    for call in getattr(msg, "tool_calls", []) or []:
                        _render_tool_call(
                            console, prefix, call.get("name", "?"), call.get("args", {}) or {}
                        )
                    text = msg.content if isinstance(msg.content, str) else ""
                    if text.strip():
                        recovered_file = _recover_inline_write_file(text)
                        if recovered_file is None:
                            _render_ai_text(console, prefix, text)
                        else:
                            path, content = recovered_file
                            files[path] = {"content": content, "encoding": "utf-8"}
                            console.print(
                                prefix,
                                Text("💾 recovered write_file ", style="green"),
                                Text(path, style="bold green"),
                                Text(f"  ({len(content)} chars)", style="dim"),
                            )
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
    ] = "MiniMaxAI/MiniMax-M3",
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
