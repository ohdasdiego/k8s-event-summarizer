# K8s Event Summarizer

A real-time Kubernetes cluster monitoring dashboard powered by Claude AI. Watches pod status, node health, deployments, and warning events — with on-demand AI-generated plain-English summaries of cluster health.

**Live demo:** https://k8s.ado-runner.com

---

## Architecture

```
Civo K8s Cluster (remote)
        │
        │  kubernetes Python client
        ▼
VPS (Flask + Gunicorn)  ──→  Anthropic API (Claude Haiku)
        │
        │  Nginx reverse proxy
        ▼
  k8s.ado-runner.com
```

- **Civo** hosts the k3s cluster with real workloads (healthy + intentionally broken)
- **Flask** queries the Kubernetes API and serves the dashboard
- **Claude Haiku** generates NOC-style plain-English cluster health summaries on demand
- **Nginx + Gunicorn** serve the app in production on the VPS

---

## Features

- Node status (Ready/NotReady, CPU, memory, version)
- Pod status across all namespaces with restart counts and status badges
- Deployment health (desired vs ready replicas)
- Warning event stream (ImagePullBackOff, CrashLoopBackOff, FailedScheduling, OOMKilled, etc.)
- On-demand Claude summary with overall status, issues, and recommendations
- Filter pods by health status or namespace
- Orange/black NOC terminal aesthetic

---

## Demo Workloads

The Civo cluster runs a mix of healthy and broken workloads to generate real events:

| Workload | Status | Purpose |
|----------|--------|---------|
| `nginx` | Running | Healthy baseline |
| `broken-app` | ImagePullBackOff | Bad image tag |
| `crashloop-demo` | CrashLoopBackOff | Exits immediately on startup |
| `starved-pod` | Pending | Resource constraints |

Deploy them:

```bash
kubectl create deployment nginx --image=nginx
kubectl create deployment broken-app --image=nginx:doesnotexist
kubectl create deployment crashloop-demo --image=busybox -- /bin/sh -c 'exit 1'
kubectl run starved-pod --image=nginx --overrides='{"spec":{"containers":[{"name":"starved-pod","image":"nginx","resources":{"requests":{"memory":"2Gi"}}}]}}'
```

---

## Local Setup

```bash
git clone https://github.com/ohdasdiego/k8s-event-summarizer
cd k8s-event-summarizer

python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Add your ANTHROPIC_API_KEY and KUBECONFIG path

python app.py  # runs on localhost:5003
```

---

## Production Deployment

```bash
# Copy project to VPS
scp -r k8s-event-summarizer/ claw@your-vps:~/

# On the VPS
cd ~/k8s-event-summarizer
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env && nano .env  # fill in API key

# Systemd service
sudo cp k8s-event-summarizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now k8s-event-summarizer

# Nginx
sudo cp nginx.conf /etc/nginx/sites-available/k8s-event-summarizer
sudo ln -s /etc/nginx/sites-available/k8s-event-summarizer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Cost Analysis

Claude Haiku pricing: $0.80/M input tokens, $4.00/M output tokens

| Component | Tokens |
|-----------|--------|
| System prompt | ~120 input |
| Cluster snapshot | ~300 input |
| Summary response | ~200 output |
| **Per summary** | **~$0.001** |

On-demand summaries (not scheduled) keep costs near zero during idle periods.

---

## Skills Demonstrated

- Kubernetes API integration via Python `kubernetes` client
- Real cluster management (Civo k3s, kubeconfig, kubectl)
- LLM-powered observability — translating raw cluster state to operator-readable digests
- Production Flask deployment (Gunicorn + Nginx + systemd)
- Frontend dashboard design (NOC aesthetic, live data, filter tabs)

---

## Roadmap

- Multi-namespace filtering
- Event history with timestamps
- Slack/PagerDuty alerting when Claude detects critical state
- Auto-refresh toggle with configurable interval
- PDF/JSON export of cluster health reports
