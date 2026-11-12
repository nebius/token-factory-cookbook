# Civo

KubeTrace connects to an **existing** Civo cluster. It never creates, resizes or deletes Civo infrastructure; the Civo API key is used only to list clusters and fetch a kubeconfig, server-side.

## 1. A cluster

If you do not have one (this is billable until deleted):

```bash
civo kubernetes create kubetrace-demo --region LON1 --nodes 2 --size g4s.kube.medium --wait
```

Two `g4s.kube.medium` nodes (2 CPU, 4 GB) run every scenario, including `memory-pressure`, which is skipped automatically if no node has 1 GiB allocatable.

## 2. Configuration

```bash
CLUSTER_KIND=civo
CIVO_API_KEY=...                 # never sent to the browser, the model or reports
CIVO_REGION=LON1
CIVO_CLUSTER_ID=<id from `civo kubernetes ls`>
REGISTRY=ttl.sh/kubetrace-<random>   # see below
```

On start, the API lists clusters in `CIVO_REGION` (`GET /v2/kubernetes/clusters?region=…`), fetches the selected cluster's kubeconfig (`GET /v2/kubernetes/clusters/{id}`), and keeps it in memory. You can also pick a cluster in **Connection → Civo → List clusters**.

The kubeconfig from Civo is cluster-admin. KubeTrace uses it **only** for the experiment harness (setup, fault injection, hidden verification, reset) and to mint a short-lived token for the `kubetrace-agent` ServiceAccount, whose Role is limited to the demo namespace (`deploy/rbac/agent-role.yaml`). The agent never sees the admin credentials.

## 3. Images

Civo nodes pull images from a registry, and they are amd64, so the build adapter builds `linux/amd64` and pushes. Results reference images **by digest**, never by a mutable tag.

- **Default for demos:** `ttl.sh/<unique-name>`, an anonymous registry where images expire after 24 h. It needs no account, and anyone who knows the name can pull. The storefront is demo code with no secrets, which is why this is acceptable here.
- **Your own registry:** set `REGISTRY` to a repository you can push to (for example `ghcr.io/<you>/kubetrace`), run `docker login` on the API host, and make the image pullable by the cluster: public, or an imagePullSecret added to the demo namespace by the setup step.

On Apple Silicon, amd64 builds run under emulation and take a minute or two.

## 4. Run

```bash
uv run kubetrace serve            # UI at http://127.0.0.1:8000, Experiments tab
# or headless
uv run kubetrace run application-bug --model-mode live
```

## Cleanup

```bash
kubectl delete namespace kubetrace-demo kubetrace-partner   # or press Reset in the UI
civo kubernetes remove kubetrace-demo --region LON1          # stops billing; only when you are done
```
