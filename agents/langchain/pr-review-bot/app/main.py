import asyncio
import hashlib
import hmac
import json
import logging
from collections import deque
from contextlib import asynccontextmanager
from typing import Any

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request, status

from app.config import Settings, get_settings
from app.github import GitHubClient
from app.reviewer import review_pull_request

logger = logging.getLogger(__name__)
processed_deliveries: deque[str] = deque(maxlen=1000)


def valid_signature(body: bytes, signature: str | None, secret: str) -> bool:
    if not signature or not signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def should_review(payload: dict[str, Any], settings: Settings) -> bool:
    pull_request = payload.get("pull_request", {})
    return payload.get("action") in {"opened", "reopened", "synchronize", "ready_for_review"} and (
        settings.review_drafts or not pull_request.get("draft", False)
    )


async def run_review(payload: dict[str, Any], settings: Settings) -> None:
    repository = payload["repository"]
    pull_request = payload["pull_request"]
    owner = repository["owner"]["login"]
    repo = repository["name"]
    number = int(pull_request["number"])
    installation_id = (payload.get("installation") or {}).get("id")
    github = GitHubClient(settings)
    try:
        context = await github.get_pull_request(owner, repo, number, installation_id)
        review = await asyncio.to_thread(review_pull_request, context, settings)
        await github.submit_review(context, review, installation_id)
        logger.info("Submitted review for %s/%s#%s with %s findings", owner, repo, number, len(review.findings))
    except Exception:
        logger.exception("PR review failed for %s/%s#%s", owner, repo, number)
    finally:
        await github.aclose()


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())
    yield


app = FastAPI(title="Deep PR Reviewer", version="0.1.0", lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/webhooks/github", status_code=status.HTTP_202_ACCEPTED)
async def github_webhook(request: Request, background_tasks: BackgroundTasks) -> dict[str, str]:
    settings = get_settings()
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256")
    if not valid_signature(body, signature, settings.github_webhook_secret.get_secret_value()):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")
    delivery = request.headers.get("X-GitHub-Delivery")
    if delivery and delivery in processed_deliveries:
        return {"status": "duplicate"}
    if delivery:
        processed_deliveries.append(delivery)
    if request.headers.get("X-GitHub-Event") == "ping":
        return {"status": "pong"}
    if request.headers.get("X-GitHub-Event") != "pull_request":
        return {"status": "ignored"}
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON") from exc
    if not should_review(payload, settings):
        return {"status": "ignored"}
    background_tasks.add_task(run_review, payload, settings)
    return {"status": "queued"}
