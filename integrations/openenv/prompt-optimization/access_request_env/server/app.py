"""
FastAPI application for the Access Request environment.

Exposes the environment over HTTP and WebSocket, compatible with
``AccessRequestEnv`` / ``MCPToolClient``.

Endpoints:
    - POST /reset, POST /step, GET /state, GET /schema, GET /health
    - WS   /ws   persistent per-session connection (what the client uses)
    - GET  /web  built-in web UI for stepping through an episode by hand
    - GET  /docs OpenAPI documentation

Run locally (from the environment directory):
    uv run --project . server --port 8000

or from the tutorial root:
    python -m access_request_env.server.app --port 8000
"""

from __future__ import annotations

import os

from openenv.core.env_server.http_server import create_app
from openenv.core.env_server.mcp_types import CallToolAction, CallToolObservation

try:
    from .access_request_environment import AccessRequestEnvironment
except ImportError:  # pragma: no cover - script style execution
    from server.access_request_environment import AccessRequestEnvironment


# Pass the class (factory) so every WebSocket session gets its own instance.
max_concurrent = int(os.getenv("MAX_CONCURRENT_ENVS", "16"))

app = create_app(
    AccessRequestEnvironment,
    CallToolAction,
    CallToolObservation,
    env_name="access_request_env",
    max_concurrent_envs=max_concurrent,
)


def main(host: str = "0.0.0.0", port: int = 8000) -> None:
    import uvicorn

    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    main(host=args.host, port=args.port)
