"""Alex's own agent (scripted MCP client) talking to the public family MCP endpoint with Alex's token."""
import asyncio
import os
import sys

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

tok = dict(p.split(":") for p in os.environ["MEMBER_TOKENS"].split(","))["dad"]


async def main():
    async with streamablehttp_client(f"{sys.argv[1].rstrip('/')}/mcp?token={tok}") as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            await s.call_tool("set_preference", {"subject": "laundry detergent", "value": "fragrance-free", "hard": True})
            await s.call_tool("add_request", {"text": "2 cartons of oat milk for me"})
            await s.call_tool("append_audit_event", {"decision": "Alex's agent: saved fragrance-free detergent preference and added oat milk"})
    print("alex agent done")

asyncio.run(main())
