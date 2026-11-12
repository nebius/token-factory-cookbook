# Troubleshooting and cleanup

| Symptom | Cause and fix |
|---|---|
| Preflight: "model access" fails | `NEBIUS_MODEL` is not in your key's catalog. Use an exact id from `GET /v1/models`. Beam is not listed as of 2026-10-16. |
| Preflight: tool calling fails | The model does not return native tool calls; the agent needs them. Pick another model. |
| `400 Unsupported reasoning_effort` | Do not set `MODEL_REASONING_EFFORT` to a value the model rejects (Muse Spark Open: low, medium, high and xhigh only). |
| Setup error "the healthy baseline did not come up" | The image could not be pulled or scheduled. Check `kubectl -n kubetrace-demo get events`. On Civo, check that `REGISTRY` is pullable. |
| Inject error "the fault did not manifest" | The harness refuses to start a run without proof of the fault. Usually the cluster is slow; reset and retry. |
| `docker push` hangs or times out | Registry slowness; pushes retry once. Try again, or use another registry. |
| Run stuck in a tool | Each tool has a time limit (90 s; builds 20 min); the agent sees the timeout as an error. Cancel from the run page if needed. |
| UI shows "reconnecting" | The SSE stream dropped; the browser reconnects and the server replays missed events. |
| `ModuleNotFoundError: kubetrace_api` | `uv sync --reinstall-package kubetrace-ai` |
| kind on macOS with Compose | The kubeconfig points at the host's 127.0.0.1. Run the API on the host. |

## Cleanup

```bash
# experiment resources (also the Reset button)
kubectl delete namespace kubetrace-demo kubetrace-partner
# local cluster and images
kind delete cluster --name kubetrace
docker image ls --filter label=kubetrace.ai/built=true -q | xargs docker image rm
docker image rm kubetrace-runner:1
# Civo cluster (billable): only when finished
civo kubernetes remove kubetrace-demo --region LON1
# local run data
rm -rf artifacts/runs artifacts/kubetrace.db
```
