"""A member's own agent, scripted: an MCP client that talks to Pantry with that member's personal token.

Run it against the MCP server that run.sh starts. The token comes from MEMBER_TOKENS in .env (the
default household: ann, shivay, yash, shane) or from PANTRY_TOKEN (the personal agent link a member
gets when they join by invite).

    set -a; . ./.env; set +a
    uv run python scripts/member_agent.py http://localhost:8701 shivay
"""
import asyncio
import json
import os
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8701").rstrip("/")
MEMBER = sys.argv[2] if len(sys.argv) > 2 else "shivay"
PAIRS = dict(p.strip().split(":", 1) for p in os.environ.get("MEMBER_TOKENS", "").split(",") if ":" in p)
TOKEN = os.environ.get("PANTRY_TOKEN") or PAIRS.get(MEMBER)
if not TOKEN:
    sys.exit(f"No token for {MEMBER}. Load .env so MEMBER_TOKENS is set, or set PANTRY_TOKEN.")


class ToolError(Exception):
    pass


async def call(session, tool, args=None):
    res = await session.call_tool(tool, args or {})
    text = "".join(getattr(c, "text", "") for c in res.content)
    if res.isError:
        raise ToolError(f"{tool} failed: {text}")
    return json.loads(text)


async def converse(session):
    ctx = await call(session, "get_group_context")
    print(f"{MEMBER} is in {ctx['group']['name']} ({len(ctx['group']['members'])} people), "
          f"run {ctx['run']['id']} is {ctx['run']['state']}")
    # Pantry asks one question at a time, so answer until the item is added.
    said = "A dozen eggs for the house."
    for _ in range(4):
        reply = await call(session, "talk_to_pantry", {"message": said})
        print(f"  > {said}\n  < {reply['reply']}")
        if reply["added"]:
            break
        said = "Saturday's run is fine." if "When" in reply["reply"] else "Yes."
    await call(session, "append_audit_event", {"decision": "Added eggs for the house over MCP"})
    snap = await call(session, "get_run_snapshot")
    print(f"the run now has {len(snap['requests'])} request(s): "
          + ", ".join(f"{q['item']} ({q['author']})" for q in snap["requests"]))


async def main():
    """Returns an error message, or None when everything worked."""
    # The token goes in a header, not the URL, so it stays out of server and proxy logs.
    async with streamablehttp_client(f"{BASE}/mcp", headers={"Authorization": f"Bearer {TOKEN}"}) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            try:
                await converse(s)
            except ToolError as e:
                return str(e)


sys.exit(asyncio.run(main()))
