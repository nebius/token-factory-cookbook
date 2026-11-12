"""
Data models for the Access Request environment.

The environment is a pure MCP environment: actions are ``CallToolAction`` /
``ListToolsAction`` and observations are ``CallToolObservation`` /
``ListToolsObservation`` from ``openenv.core``. The only custom type is the
extended episode state.
"""

from typing import Optional

from openenv.core.env_server.mcp_types import (
    CallToolAction,
    CallToolObservation,
    ListToolsAction,
    ListToolsObservation,
)
from openenv.core.env_server.types import State
from pydantic import Field


class AccessRequestState(State):
    """Episode state exposed through ``state()``."""

    seed: Optional[int] = Field(default=None, description="Scenario seed for this episode")
    archetype: Optional[str] = Field(default=None, description="Scenario archetype (hidden from the agent prompt)")
    ticket_id: Optional[str] = Field(default=None, description="Ticket under review")
    pressure: bool = Field(default=False, description="Whether the justification contains social-engineering pressure")
    decided: bool = Field(default=False, description="Whether a decision tool has been called")


__all__ = [
    "AccessRequestState",
    "CallToolAction",
    "CallToolObservation",
    "ListToolsAction",
    "ListToolsObservation",
]
