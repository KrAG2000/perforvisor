# vLLM on GKE

The model server runs on CPU for now, with a GPU path ready when it's needed. Both use the same base (`deploy/k8s/base`) and differ only in the component they include:

| Overlay | Component | Runs on | Context |
|---|---|---|---|
| `deploy/k8s/overlays/gke-cpu` | `components/vllm-cpu` | `llm-cpu` node pool (C3: AVX-512 + AMX) | 8k tokens |
| `deploy/k8s/overlays/gke-gpu` | `components/vllm-gpu` | `gpu-l4` node pool (NVIDIA L4, Spot) | 32k tokens |

Both expose the same Service (`vllm.perforvisor.svc.cluster.local:8000`), so the backend doesn't change when switching.

## Prerequisites

- `gcloud`, `kubectl` and the GKE auth plugin (`gcloud components install kubectl gke-gcloud-auth-plugin`)
- A project with billing enabled

## 1. Create the cluster

```bash
export PROJECT_ID=your-project
export ZONE=us-central1-a
export CLUSTER=perforvisor

gcloud config set project $PROJECT_ID
gcloud services enable container.googleapis.com

# Small pool for system pods (and later the API, worker and frontends)
gcloud container clusters create $CLUSTER \
  --zone $ZONE \
  --machine-type e2-standard-4 \
  --num-nodes 1 \
  --release-channel regular

gcloud container clusters get-credentials $CLUSTER --zone $ZONE
```

## 2. CPU model server (current setup)

C3 machines have AVX-512 and AMX, which vLLM's CPU backend uses for bf16; they are several times faster than AVX2-only machines for this.

```bash
gcloud container node-pools create llm-cpu \
  --cluster $CLUSTER \
  --zone $ZONE \
  --machine-type c3-standard-8 \
  --num-nodes 1

kubectl apply -k deploy/k8s/overlays/gke-cpu
kubectl -n perforvisor rollout status deploy/vllm --timeout=20m
```

## 3. Test it

```bash
kubectl -n perforvisor port-forward svc/vllm 8000:8000

curl localhost:8000/v1/models
curl localhost:8000/v1/chat/completions -H 'Content-Type: application/json' -d '{
  "model": "Qwen/Qwen3-0.6B",
  "messages": [{"role": "user", "content": "Say hi in five words."}],
  "chat_template_kwargs": {"enable_thinking": false}
}'
```

With the port-forward running, the local backend can use it unchanged (`LLM_BASE_URL=http://localhost:8000/v1`).

## Switching to GPU later

Needs L4 GPU quota in your region (IAM & Admin → Quotas → "Preemptible NVIDIA L4 GPUs"; new projects often have 0).

```bash
gcloud container node-pools create gpu-l4 \
  --cluster $CLUSTER \
  --zone $ZONE \
  --machine-type g2-standard-8 \
  --accelerator type=nvidia-l4,count=1,gpu-driver-version=latest \
  --spot \
  --num-nodes 1 \
  --enable-autoscaling --min-nodes 0 --max-nodes 1

kubectl apply -k deploy/k8s/overlays/gke-gpu
kubectl -n perforvisor rollout status deploy/vllm --timeout=20m

# Once it's healthy, remove the CPU pool
gcloud container node-pools delete llm-cpu --cluster $CLUSTER --zone $ZONE
```

The Deployment uses the `Recreate` strategy, so the CPU pod stops before the GPU pod starts; expect a few minutes of downtime while the GPU image (~10 GB) is pulled.

## Changing the model

Edit `LLM_MODEL` in `deploy/k8s/base/vllm/kustomization.yaml`, re-apply, and set the backend's `LLM_MODEL` to match. Check the model card for its recommended `--reasoning-parser` and `--tool-call-parser` (e.g. Qwen3.5 uses `qwen3_coder` for tools). Gated models need a token:

```bash
kubectl -n perforvisor create secret generic hf-token --from-literal=token=hf_xxx
```

Note on configuration: values set by a component (`VLLM_CPU_KV_CACHE_BYTES`, `VLLM_GPU_MEMORY_UTILIZATION`) override the same keys set in an overlay, because Kustomize merges components last. Change those in the component.

## Cost control

```bash
kubectl -n perforvisor scale deploy/vllm --replicas=0
gcloud container node-pools resize llm-cpu --cluster $CLUSTER --zone $ZONE --num-nodes 0

# Or delete everything
gcloud container clusters delete $CLUSTER --zone $ZONE
```
