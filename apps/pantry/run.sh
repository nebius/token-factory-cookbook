#!/usr/bin/env bash
# Start (or restart) the web/API server (:8700) and the MCP server (:8701) on this machine.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p logs data
if [ ! -f .env ]; then umask 077; touch .env; fi
chmod 600 .env
# Per-member MCP tokens: generated once, kept only in .env.
if ! grep -q '^MEMBER_TOKENS=' .env; then
  echo "MEMBER_TOKENS=shivay:$(openssl rand -hex 16),dad:$(openssl rand -hex 16)" >> .env
fi
set -a; . ./.env; set +a
pkill -f "uvicorn app.server:app" 2>/dev/null || true
pkill -f "python -m app.mcp_server" 2>/dev/null || true
sleep 1
nohup .venv/bin/uvicorn app.server:app --host 0.0.0.0 --port 8700 > logs/web.log 2>&1 &
nohup .venv/bin/python -m app.mcp_server > logs/mcp.log 2>&1 &
for i in $(seq 1 30); do curl -sf localhost:8700/api/state >/dev/null && break; sleep 1; done
curl -sf localhost:8700/api/state >/dev/null && echo "web ok :8700" || { echo "web failed"; tail -20 logs/web.log; }
for i in $(seq 1 30); do (echo > /dev/tcp/127.0.0.1/8701) 2>/dev/null && break; sleep 1; done
(echo > /dev/tcp/127.0.0.1/8701) 2>/dev/null && echo "mcp ok :8701" || { echo "mcp failed"; tail -20 logs/mcp.log; }
