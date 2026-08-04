.PHONY: install-backend install-frontend dev-backend dev-frontend test build

install-backend:
	cd backend && python3 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"

install-frontend:
	cd frontend && npm install

dev-backend:
	cd backend && uvicorn app.main:app --reload --host 127.0.0.1 --port 18765

dev-frontend:
	cd frontend && npm run dev -- --host 127.0.0.1 --port 14321

test:
	cd backend && pytest

build:
	cd frontend && npm run build
