"""Small sync helper for calling tools on remote MCP servers (Firedrill apps, Senso)."""
import asyncio
import json


async def _call(url, headers, name, args, timeout):
    from mcp import ClientSession
    from mcp.client.streamable_http import streamablehttp_client
    async with streamablehttp_client(url, headers=headers or {}, timeout=timeout) as (r, w, _):
        async with ClientSession(r, w) as s:
            await s.initialize()
            res = await s.call_tool(name, args)
            text = "".join(getattr(c, "text", "") for c in res.content)
            try:
                data = json.loads(text)
            except Exception:
                data = {"text": text}
            return {"ok": not res.isError, "data": data}


def call(url, name, args, headers=None, timeout=60):
    from . import tokens
    try:
        with tokens.tool_call(name.replace(".", "-")):
            return asyncio.run(asyncio.wait_for(_call(url, headers, name, args, timeout), timeout + 5))
    except Exception as e:
        return {"ok": False, "data": {"error": f"{type(e).__name__}: {str(e)[:200]}"}}
