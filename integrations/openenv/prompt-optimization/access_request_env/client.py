"""
Typed client for the Access Request environment.

``AccessRequestEnv`` is an OpenEnv ``MCPToolClient``: it speaks the
reset/step/state protocol over a persistent WebSocket and exposes
``list_tools()`` / ``call_tool()`` helpers for MCP tool environments.

Example (sync):
    >>> from access_request_env import AccessRequestEnv, CallToolAction
    >>> with AccessRequestEnv(base_url="http://localhost:8000").sync() as env:
    ...     result = env.reset(seed=1003)
    ...     ticket = result.observation.metadata["ticket"]
    ...     tools = env.list_tools()
    ...     result = env.step(CallToolAction(tool_name="get_employee",
    ...                                      arguments={"employee_id": ticket["requester_id"]}))
    ...     print(result.observation.result["data"])
"""

from __future__ import annotations

from typing import Any, Dict

from openenv.core.mcp_client import MCPToolClient

from .models import AccessRequestState


class AccessRequestEnv(MCPToolClient):
    """Client for the Access Request environment."""

    def _parse_state(self, payload: Dict[str, Any]) -> AccessRequestState:
        return AccessRequestState(**payload)


def tool_payload(observation: Any) -> Any:
    """Extract the JSON-friendly payload of a ``CallToolObservation``.

    The server serialises FastMCP's ``CallToolResult``; the useful part is the
    ``data`` field. Transport or validation errors are surfaced as a dict with
    an ``error`` key so an LLM agent can read them.
    """
    error = getattr(observation, "error", None)
    if error is not None:
        return {"error": error.message, "error_type": getattr(error.error_type, "value", str(error.error_type))}
    result = getattr(observation, "result", None)
    if isinstance(result, dict):
        if "data" in result:
            return result["data"]
        if "structured_content" in result and isinstance(result["structured_content"], dict):
            return result["structured_content"].get("result", result["structured_content"])
        return result
    if hasattr(result, "data"):
        return result.data
    return result
