"""CLI entry point: ``uv run ci-agent <company>``."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Annotated

import typer
from dotenv import load_dotenv
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel
from rich.rule import Rule

from ci_agent.agent import build_agent
from ci_agent.stream import render_stream

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
    that shape or a plain string (for forward/backward compatibility).
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
    """Pull the generated brief out of the agent's virtual FS.

    The agent may write it as ``brief.md`` or ``/brief.md`` depending on how
    it formats the path; accept either.
    """
    for key in ("brief.md", "/brief.md"):
        if key in files:
            return _file_content(files[key])
    # Last-ditch: any file ending in brief.md.
    for key, value in files.items():
        if key.endswith("brief.md"):
            return _file_content(value)
    return None


@app.command()
def brief(
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
            help="Where to write the final brief. Defaults to ./brief-<company>.md.",
        ),
    ] = None,  # type: ignore[assignment]
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

    output = output or Path(f"brief-{company.lower().replace(' ', '-')}.md")

    console.print(
        Panel(
            f"[bold]Company:[/] {company}\n"
            f"[bold]Model:[/]   {model} [dim](via Nebius Token Factory)[/]\n"
            f"[bold]Output:[/]  {output}",
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

    output.write_text(brief_md, encoding="utf-8")
    console.print(Markdown(brief_md))
    console.print(Rule(style="dim"))
    console.print(f"[green]✓[/] Brief saved to [bold]{output}[/]")


if __name__ == "__main__":
    app()
