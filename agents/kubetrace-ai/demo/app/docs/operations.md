# Operations

| Endpoint | Purpose |
|---|---|
| `GET /healthz` | Liveness: the process is serving HTTP. |
| `GET /readyz` | Readiness: configuration loaded and the cache warmed. Returns 503 while starting. |
| `GET /version` | The running build (`APP_VERSION`). |
| `GET /api/catalog` | Products. |
| `POST /api/checkout` | Price an order. See pricing.md. |

The container listens on port 8080 (named `http`). The Service exposes port 80.
Logs go to stdout; a failed checkout logs its request id and a traceback.
