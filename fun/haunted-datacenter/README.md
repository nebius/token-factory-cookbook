# Haunted Datacenter Escape Room

Run a three-room escape game that combines web research, vision inference, LoRA fine-tuning, and a cloud cooling controller. Friends discuss the puzzles while one person operates each game in a local browser. The haunted building and sensor readings are simulated; the API calls, training, and cloud deployments are real.

This recipe uses [Haunted Datacenter by gogococo](https://github.com/gogococo/haunted-datacenter), release [`stream-host-v2`](https://github.com/gogococo/haunted-datacenter/releases/tag/stream-host-v2), commit `fb7c5d2f5c405f876e31be093e4204f0b553ef52`. The game code stays in its upstream repository. The recommended setup runs the web app locally and trains/serves the caretaker on one warm Nebius Serverless AI GPU.

## What you will build

The local game server coordinates these services:

| Room | Task | Service that does real work |
| --- | --- | --- |
| Haunted switchboard | Research MQTT wildcard rules, inspect a source, and repair message routing | Tavily Search and Extract |
| Network operations center | Inspect camera images, restore a personality, record demonstrations, and train the caretaker | Nebius Token Factory vision/dialogue; Nebius AI Cloud Serverless AI GPU for LoRA training and command inference |
| Generator room | Repair the simulated loop, commission the controller, and verify cooling | Shared Nebius AI Cloud Serverless AI CPU endpoint; trained caretaker for the final door decision |

The GPU keeps the pinned `Qwen/Qwen3-0.6B` base model warm. Separate training and inference pools share that GPU, selecting and verifying each player's adapter. Their queues continue automatically; each player does not need a separate GPU endpoint. Token Factory personality dialogue is separate from equipment commands and cannot authorize the exit.

Each game has an independent UUID save and private resume link. Friends can help solve one game together; shared co-op clicking and synchronization are not implemented. The local web app needs no PyTorch installation, local model download, or loopback model runner for the recommended path.

## Credentials and access

Prepare the following before starting. Local web hosting still calls paid cloud services and requires a warm GPU.

| Credential or setting | Required? | Purpose and where to obtain it |
| --- | --- | --- |
| `NEBIUS_API_KEY` | Yes | API key from the **API keys** section of [Token Factory](https://tokenfactory.nebius.com/). The account needs image inference and personality dialogue with `Qwen/Qwen3-30B-A3B-Instruct-2507`. The game also lists models, dedicated endpoints, and endpoint templates during connection. Managed Token Factory fine-tuning credentials/capabilities are only needed for the optional legacy path. |
| `TAVILY_API_KEY` | Yes, or an authenticated Tavily CLI session | Key from [Tavily](https://app.tavily.com/) for Search and Extract. `tvly login` is an alternative to the environment variable. |
| Nebius AI Cloud CLI authentication | Yes | A signed-in `nebius` CLI profile with access to inspect the project/subnet, manage GPU and CPU Serverless AI endpoints and their logs, and attach the worker filesystem. Creating a filesystem also needs storage permissions. Use your own [Nebius AI Cloud account](https://console.nebius.com/). This authentication is separate from the Token Factory key. |
| `NEBIUS_PROJECT_ID` | Yes; identifier, not a secret | Your AI Cloud project with billing and available GPU, CPU, disk, and filesystem quota. |
| `NEBIUS_SUBNET_ID` | Yes; identifier, not a secret | A compatible subnet for the GPU worker and CPU controller. The tagged worker example uses `gpu-l40s-a` / `1gpu-8vcpu-32gb`; the controller uses `cpu-d3` / `2vcpu-8gb`. Verify regional availability. |
| `TRAINING_FILESYSTEM_ID` | Yes for worker provisioning; identifier, not a secret | A compatible persistent filesystem mounted at `/mnt/persist` on the GPU worker. Holds model cache, datasets, adapters, and receipts. This is a provisioning setting, not a game-server credential. |
| `CARETAKER_WORKER_URL` | Yes for the recommended path | Managed HTTPS URL of your ready GPU endpoint, ending in `.nebius.cloud`. Keep it in the server environment. |
| `CARETAKER_WORKER_TOKEN` | Yes for the recommended path; secret | A generated private token used by both endpoint authentication and the worker application. Configure the same token on the GPU and local game server. It is not a Token Factory key. |
| Vision model access | Yes | An image-capable serverless model visible to this account, or an enabled compatible dedicated vision endpoint. No additional API key is needed if covered by `NEBIUS_API_KEY`. |
| Hugging Face token | Usually no | The GPU downloads the public Qwen model anonymously. No local Hugging Face login is required for this path. |
| `HOST_ACCESS_CODE`, `SESSION_SECRET` | No for local play | Optional host tools/public hosting. Normal games use their UUID and per-game request token, supplied by the UI. |
| `NEBIUS_SERVICE_ACCOUNT_ID`, `NEBIUS_PUBLIC_KEY_ID`, `NEBIUS_PRIVATE_KEY` | No with an interactive CLI profile | Alternative unattended authentication for containers. A service-account private key is not needed for the local interactive setup. |

Follow the official [Token Factory authentication guide](https://docs.tokenfactory.nebius.com/api-reference/introduction). Model availability and quota can change. Check account access before provisioning; a successful model listing does not prove that image or dialogue inference will succeed.

Keep secrets in the server environment or a private `.env` file. Never put them in browser fields, chat prompts, screenshots, or Git. The game generates the cooling controller's bearer token itself. UUID resume links are also bearer secrets: anyone with the link can resume that game.

## Set up locally

Use Git, Python 3.12 with TLS support, the Nebius AI Cloud CLI, and a GPU-capable project with a persistent filesystem. No domain, registry, public game host, or Cloudflare Worker is required for local web hosting.

### 1. Check out the release

Clone into a separate working directory outside the cookbook checkout to keep game runtime files out of the cookbook.

```bash
git clone --branch stream-host-v2 --depth 1 https://github.com/gogococo/haunted-datacenter.git
cd haunted-datacenter
git rev-parse HEAD
```

Confirm the printed SHA is `fb7c5d2f5c405f876e31be093e4204f0b553ef52`. Stop if it differs.

### 2. Install the local tools

The web app uses Python's standard library and the Tavily CLI. Model dependencies are installed on the GPU by the tagged startup script.

```bash
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install tavily-cli==0.1.8
tvly --status
nebius ai endpoint create --help
```

Authenticate the Nebius CLI using its installed version's setup instructions, then select your project and subnet. The game invokes this CLI noninteractively, so complete browser login in advance. The tagged Dockerfile uses Nebius CLI `0.12.295`; check that your installed CLI supports the flags in `serverless.py` and `deploy/TRAINING.md`, including file injection and filesystem mounts.

### 3. Configure the game and provision the GPU worker

Copy this recipe's [`env.example`](env.example) into the game checkout as `.env`. Fill the provider keys, project/subnet IDs, and filesystem ID locally using an editor. Generate a private worker token and configure it consistently on both services. Fill `CARETAKER_WORKER_URL` once the GPU has its managed URL. The game does not load `.env` automatically.

```bash
chmod 600 .env
set -a
source .env
set +a
```

Load only a file you created and trust: `source` executes shell syntax. Keep this shell open for the game server. If you prefer Tavily OAuth, leave `TAVILY_API_KEY` blank and run `tvly login` before starting.

Follow the pinned [warm GPU instructions](https://github.com/gogococo/haunted-datacenter/blob/fb7c5d2f5c405f876e31be093e4204f0b553ef52/deploy/TRAINING.md) from the game checkout. Reuse an existing compatible worker/filesystem, or provision one worker with these tagged settings:

| Setting | Tagged worker example |
| --- | --- |
| Image | `pytorch/pytorch:2.8.0-cuda12.8-cudnn9-runtime` |
| Platform / preset | `gpu-l40s-a` / `1gpu-8vcpu-32gb` |
| Container disk / shared memory | `200Gi` / `2Gi` |
| Persistent mount | `TRAINING_FILESYSTEM_ID:/mnt/persist:rw` |
| Entrypoint | `bash /opt/training-start.sh` |
| Injected source | `deploy/training-start.sh` and `training_worker.py` from this checkout |
| Port / authentication | `8000/http`; token authentication and matching worker token |
| Worker pool defaults | Two training processes and four inference processes on one GPU |

The tagged guide contains the full create command. Its literal-token arguments and CLI error output must stay private; use SecretStash token/environment selectors for unattended provisioning. Do not paste secret-bearing output into chat. Keep the startup script's dependency pins and the worker's model revision unchanged. The worker downloads the model itself.

Wait for the worker's **authenticated `/healthz` JSON to report `ready: true`**. An endpoint state of RUNNING or an HTTP 200 alone does not prove the model pools are ready. Save its managed HTTPS URL and matching token in `.env`, then reload that file into the server's shell. The one-shot prompt below can perform this provisioning and readiness work.

### 4. Start the game

In the terminal that loaded `.env`, run:

```bash
source .venv/bin/activate
python server.py
```

Open **http://127.0.0.1:8765**, choose **New game**, enter a display name, then **Enter The Datacenter**. Use **Resume** with the saved UUID/link to continue. Keep the URL private. Progress and checkpoints live in `.runtime/runs/<UUID>/`; the leaderboard is shared and persistent.

Use one local game-server process per project for this shared controller setup. Keep its private runtime directory across restarts; the GPU filesystem separately preserves model/job data. Starting over creates a new UUID and keeps the old save and scores.

## One-shot setup prompt

Paste this into a coding agent with terminal access, or use the standalone [setup prompt](setup-prompt.txt). It prepares local hosting and the required warm GPU. Account login, missing credentials, resource selections, and billing approval can still need your input.

```text
Set up Haunted Datacenter with a local web app from gogococo/haunted-datacenter
release stream-host-v2, exact commit fb7c5d2f5c405f876e31be093e4204f0b553ef52.
Read the tagged README, deploy/TRAINING.md, deploy/training-start.sh,
training_worker.py, training_cloud.py, caretaker.py, and serverless.py first.
Use the recommended warm Serverless GPU path, not the legacy local CPU runner.

1. Clone into a separate directory, verify the commit, create a Python 3.12
   virtual environment, and install tavily-cli==0.1.8. The local web server
   does not need torch, requirements-model.txt, or a local model download.
2. Check NEBIUS_API_KEY and Tavily CLI authentication (TAVILY_API_KEY or
   tvly login) without printing secret values. Have me enter missing secrets
   locally, never in chat. Use an ignored .env with restrictive permissions
   and load it explicitly; this game has no dotenv loader. Check my nebius
   CLI profile is authenticated separately from the Token Factory key.
3. Discover my project, subnet, and compatible persistent filesystem using
   read-only operations. Reuse existing resources; ask me to select when
   ambiguous. Check regional availability, endpoint/storage permissions,
   and GPU/CPU/disk/filesystem quotas. Export NEBIUS_PROJECT_ID and
   NEBIUS_SUBNET_ID. Use TRAINING_FILESYSTEM_ID for worker provisioning.
4. Check Token Factory model, dedicated endpoint, and template listing.
   Verify access to a compatible vision model and the personality dialogue
   model Qwen/Qwen3-30B-A3B-Instruct-2507. Explain billed inference checks
   before running them. Prefer an available serverless vision model or
   compatible existing dedicated endpoint. Managed Token Factory fine-tuning
   and checkpoint downloads are not required for the warm-worker path.
5. Reuse a compatible ready worker if supplied. Otherwise prepare a concrete
   GPU/filesystem plan from deploy/TRAINING.md: one gpu-l40s-a worker,
   1gpu-8vcpu-32gb, 200Gi container disk, 2Gi shared memory, persistent
   /mnt/persist mount, pinned image/startup script/model, port 8000/http,
   and private token authentication. Use the tagged default pool sizes.
   Report capacity, region, storage sizing, billing implications, and exact
   resources to create. Get approval for new paid infrastructure, including
   any necessary dedicated vision endpoint, before provisioning it.
6. Generate/reuse CARETAKER_WORKER_TOKEN privately, configure the same token
   for endpoint authentication, worker environment, and local game server.
   Prefer SecretStash selectors to literal CLI tokens. Keep raw CLI output
   private because errors can echo tokens. Record resource IDs, not secrets.
   Use CARETAKER_WORKER_URL for its managed HTTPS .nebius.cloud URL. Wait
   for authenticated /healthz JSON with ready:true; RUNNING is insufficient.
   Do not silently change pinned dependencies, model revision, or game code.
7. Start the web app on 127.0.0.1:8765 with those environment settings.
   Verify /healthz and the welcome page. Record PID and private log path.
   Run all tagged Python tests in a temporary GAME_DATA_DIR. These tests
   mock cloud/model work and cannot prove live GPU or provider readiness.
8. Leave submitting player training jobs, commissioning the shared cooling
   controller, and solving rooms to gameplay. Do not load an old adapter,
   pre-solve rooms, or create a cloud web host, registry, or public tunnel.
9. Return the local URL, credential names/readiness (no values), selected
   project/subnet, worker/filesystem IDs and readiness, vision/dialogue
   models, validation evidence, unresolved prerequisites, and cleanup steps.
   Explain private UUID resume links and independent saves. Finish/reset
   releases a cooling lease and stops the controller only when no active
   users remain; GPU jobs continue independently and the warm GPU must be
   stopped separately. Preserve both local saves and worker storage.
```

## Verify and play

Check the local web app from another terminal:

```bash
curl --fail http://127.0.0.1:8765/healthz
```

Check worker readiness with an authenticated request from the server environment. Keep the response local; this prints only the readiness boolean and passes the token in a header without placing it in a shell command argument.

```bash
python - <<'PY'
import training_cloud
health = training_cloud.api('/healthz')
print('Worker ready:', health.get('ready') is True)
assert health.get('ready') is True, 'Wait for GPU model pools to finish loading'
PY
```

In the NOC, **Connect Token Factory** should discover account resources and report the warm training GPU ready. Inspect a camera and restore a personality to verify actual Token Factory calls. Those inference checks are billed. Each game submits and loads its own adapter; it must pass fresh camera/command checks, live cloud cooling checks, and a trained caretaker decision to open the final door.

Run the tagged automated tests with disposable state:

```bash
GAME_DATA_DIR=$(mktemp -d) .venv/bin/python -m unittest discover -q
```

These tests mock external services/model execution. A full integration check requires live Tavily Search and Extract, Token Factory vision/dialogue, this player's GPU training and checkpoint selection, and the deployed cooling controller. Do not describe mocked tests as a verified cloud playthrough. Training and inference have separate bounded queues; a queued operation continues automatically. Preflight with the expected number of players before raising pool sizes.

## Costs and cleanup

Tavily Search/Extract, Token Factory inference, the warm GPU, persistent storage, and the CPU controller have separate usage charges. The warm GPU stays allocated between jobs. Check account pricing and budget before provisioning it. Cold startup includes image/model downloads and loading multiple model processes; the 45-minute game format is presentation pacing, not a completion-time guarantee.

Finishing or starting over releases that game's cooling-controller lease. The shared controller stops when no active leases remain. Abandoned browser leases expire after 20 minutes and a periodic sweep can stop the unused controller. A later game can wake the existing controller, which can take several minutes. Verify actual endpoint state and any cleanup errors rather than assuming it has stopped.

GPU training jobs continue independently of game resets and completion. Stop the warm GPU endpoint separately after all players finish and pending work is no longer needed. Stop any dedicated vision endpoint created solely for this demo through Token Factory. Review current and earlier cloud attempts; an uncertain create can have succeeded even when no response arrived.

Stop the local web app with Ctrl-C. Preserve `.runtime/` for private UUID saves, scores, and controller receipts, and preserve the GPU filesystem for datasets, model cache, adapters, and job receipts. Review retained storage charges before deciding whether to delete it. Never delete a shared filesystem or stop a shared endpoint while other players need it.

## Optional legacy path

The tag retains managed Token Factory fine-tuning with a loopback CPU runner for earlier saves. This path needs Token Factory file upload/fine-tuning/checkpoint access, local PyTorch and model dependencies, and matching runtime directories. It can require importing the final adapter from the same job after a download `AccessDenied`. Follow the pinned [training guide's legacy section](https://github.com/gogococo/haunted-datacenter/blob/fb7c5d2f5c405f876e31be093e4204f0b553ef52/deploy/TRAINING.md#optional-earlier-path); do not mix its credentials, checkpoint workflow, or latency expectations with the warm-worker setup above.

## Troubleshooting

Use these checks when setup fails:

| Symptom | Check |
| --- | --- |
| Token Factory works but cloud provisioning fails | The separate `nebius` CLI profile, project/subnet, permissions, compatible flags, and CPU/GPU/storage quotas. |
| Worker configured but cannot connect | Both `CARETAKER_WORKER_URL` and `CARETAKER_WORKER_TOKEN`, matching endpoint/application tokens, and authenticated `ready:true`. |
| No camera model or personality response | Account-visible image model and access to the tagged dialogue model; Connect Token Factory must succeed. |
| Tavily unavailable | Activate the virtual environment before starting the server; `tvly` must be on its PATH and authenticated. |
| Missing credentials despite `.env` being present | Load `.env` into the server's shell before launching it. |
| Model work is queued | Allow automatic continuation; training and inference have separate queues on the shared GPU. |
| Cooling app wakes slowly | It stops when unused; a new start can require container startup before HTTP readiness. |
| Cloud create timed out | Check the provider console and receipts before retrying to avoid duplicate resources. |
