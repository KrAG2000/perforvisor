# Model servers on GKE

Both model servers run on **one NVIDIA L4** in a small GKE cluster and are reachable over HTTPS, so the backend on Vercel can call them:

| Server | Model | Share of the L4 (24 GB) | Public URL |
|---|---|---|---|
| `vllm` (chat, extraction) | qwen3-4b → `Qwen/Qwen3-4B-AWQ` | 60% | `https://chat.<ip>.sslip.io/v1` |
| `vllm-embed` (embeddings) | EmbeddingGemma 2 → `google/embeddinggemma-2` | 15% | `https://embed.<ip>.sslip.io/v1` |

Manifests: `deploy/k8s/overlays/gke-gpu` (base + `deploy/k8s/embed` + `components/vllm-gpu` + HTTPS exposure). Every `/v1` call needs the API key; `/health` stays open for the load balancer.

How it fits on one GPU: GKE **GPU time-sharing** advertises the single L4 as 2 schedulable GPUs, one per server, and each vLLM process takes a fixed share of memory (`--gpu-memory-utilization`). The node is a **Spot** `g2-standard-4` (4 vCPU, 16 GB, 1 L4).

`<ip>.sslip.io` resolves to `<ip>` without any DNS setup, which lets Google issue a managed certificate without a domain.

## Current deployment

| | |
|---|---|
| Project | `gke-llm-deployment` |
| Cluster | `perforvisor`, zone `us-central1-a`, Standard, release channel regular |
| Static IP | `perforvisor-llm-ip` = `136.81.123.68` (global) |
| Hostnames | `chat.136.81.123.68.sslip.io`, `embed.136.81.123.68.sslip.io` |

## Set up from scratch

Prerequisites: `gcloud`, `kubectl`, `gke-gcloud-auth-plugin`; a project with billing on a **paid** account (free trials can't use GPUs).

### 1. GPU quota

A new project has `NVIDIA_L4_GPUS` = 1 in each region but `GPUS_ALL_REGIONS` = 0, which blocks every GPU. Request 1:

```bash
export P=gke-llm-deployment
gcloud services enable container.googleapis.com compute.googleapis.com cloudquotas.googleapis.com --project $P
gcloud beta quotas preferences create --service=compute.googleapis.com \
  --quota-id=GPUS-ALL-REGIONS-per-project --preferred-value=1 --project=$P \
  --preference-id=gpus-all-regions-1 --email=<you> \
  --justification="Serving open-weight models with vLLM on one L4"
gcloud beta quotas preferences describe gpus-all-regions-1 --project $P   # grantedValue: 1
```

### 2. Static IP and cluster

```bash
gcloud compute addresses create perforvisor-llm-ip --global --project $P
gcloud compute addresses describe perforvisor-llm-ip --global --project $P --format="value(address)"

gcloud container clusters create perforvisor --project $P --zone us-central1-a \
  --machine-type g2-standard-4 \
  --accelerator type=nvidia-l4,count=1,gpu-driver-version=latest,gpu-sharing-strategy=time-sharing,max-shared-clients-per-gpu=2 \
  --spot --num-nodes 1 --enable-autoscaling --min-nodes 0 --max-nodes 1 \
  --disk-size 100 --release-channel regular
```

If a zone has no Spot L4 capacity, try `us-central1-b` or `-c`. GKE's free tier covers the management fee of one zonal cluster.

### 3. Hostnames

Put the static IP into `deploy/k8s/overlays/gke-gpu/kustomization.yaml` (`llm-hosts`: `CHAT_HOST`, `EMBED_HOST`).

### 4. Secrets and deploy

```bash
kubectl create namespace perforvisor
kubectl -n perforvisor create secret generic vllm-api-key --from-literal=key="$MODEL_API_KEY"
kubectl -n perforvisor create secret generic hf-token --from-literal=token="$HF_TOKEN"   # optional
kubectl apply -k deploy/k8s/overlays/gke-gpu
```

`MODEL_API_KEY` is the same value the backend uses (`.env`, and the Vercel project's environment variables).

### 5. Wait and test

First start pulls the vLLM image (~10 GB) and the models; the managed certificate takes 15–60 minutes after the Ingress gets its IP.

```bash
kubectl -n perforvisor get pods
kubectl -n perforvisor get managedcertificate vllm      # Status: Active

curl https://chat.136.81.123.68.sslip.io/v1/models -H "Authorization: Bearer $MODEL_API_KEY"
curl https://embed.136.81.123.68.sslip.io/v1/embeddings -H "Authorization: Bearer $MODEL_API_KEY" \
  -H 'Content-Type: application/json' -d '{"model":"google/embeddinggemma-2","input":["hello"]}'
```

Backend settings:

```
CHAT_BASE_URL=https://chat.136.81.123.68.sslip.io/v1
EMBED_BASE_URL=https://embed.136.81.123.68.sslip.io/v1
MODEL_API_KEY=<same key>
```

## Notes

- **Embedding patch:** `deploy/k8s/embed/triton_prefill_attention.py` is mounted over vLLM's file. vLLM sizes EmbeddingGemma 2's prefill tiles for A100/H100 shared memory; the L4 (like RTX 40-series) has ~99 KB per block, so unpatched it crashes at startup. Remove it once fixed upstream.
- **Spot:** the node can be reclaimed; GKE recreates it and the pods restart (model weights are cached on persistent disks).
- **Namespace:** set in the overlay, not just in base, so resources outside base (embed, exposure) land in `perforvisor` too.

## Cost control

```bash
# Stop the GPU when not in use (pods go Pending, the node pool scales to 0)
kubectl -n perforvisor scale deploy/vllm deploy/vllm-embed --replicas=0
# Start again
kubectl -n perforvisor scale deploy/vllm deploy/vllm-embed --replicas=1

# Remove everything
gcloud container clusters delete perforvisor --zone us-central1-a --project $P
gcloud compute addresses delete perforvisor-llm-ip --global --project $P
```

The Ingress (global load balancer) is billed while it exists, even with the GPU scaled to zero.
