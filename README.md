# K8s Event Summarizer

A production-grade Kubernetes cluster monitoring dashboard with AI-powered health analysis. Watches pod status, node health, deployments, and warning events — and generates on-demand plain-English NOC digests via Claude.

> Live K8s cluster data → AI health analysis → real-time dashboard. Connected to a real Civo k3s cluster with healthy and intentionally broken workloads.

---

## Live Demo

🔗 **[k8s.ado-runner.com](https://k8s.ado-runner.com)**

---

## What It Does

A Flask app connects to a live Kubernetes cluster via the Python `kubernetes` client, collects real-time cluster state, and serves it on a dark NOC-style dashboard that auto-refreshes every 30 seconds.

**Cluster data collected:**
- Node status (Ready/NotReady, CPU allocatable, memory allocatable, k8s version, age)
- Pod status across all namespaces (phase, restart count, container readiness)
- Deployment health (desired vs ready replicas)
- Warning events (ImagePullBackOff, CrashLoopBackOff, OOMKilled, FailedScheduling, etc.)

**AI analysis output (on demand):**
- **Overall Status** — one-sentence healthy/degraded/critical assessment
- **Issues** — bullet list of specific problems detected in the cluster
- **Recommendation** — one actionable next step for the on-call engineer

---

## Sample Output

### Dashboard Stats (healthy cluster)

```
Nodes Ready: 1/1   Pods Running: 4   Pods Unhealthy: 3   Deployments: 3/5   Warning Events: 8
```

### AI Health Digest

```
Overall Status: DEGRADED — 3 of 5 deployments are unhealthy with active crash loops.

Issues:
- broken-app (default): ImagePullBackOff — image nginx:doesnotexist not found
- crashloop-demo (default): CrashLoopBackOff — container exits immediately on startup (restarts: 47)
- starved-pod (default): Pending — insufficient memory, requesting 2Gi on a node with 1.8Gi allocatable

Recommendation: Fix the broken image tag in broken-app, patch crashloop-demo's entrypoint,
and either reduce starved-pod's memory request or add a larger node to the cluster.
```

### API Response — `/api/cluster` (truncated)

```json
{
  "nodes": [
    {
      "name": "k3s-node-1",
      "status": "Ready",
      "cpu": "2",
      "memory": "3882756Ki",
      "version": "v1.28.7+k3s1",
      "age": "2d"
    }
  ],
  "pods": [
    { "name": "nginx-xxx", "namespace": "default", "status": "Running", "restarts": 0, "age": "2d" },
    { "name": "crashloop-demo-xxx", "namespace": "default", "status": "CrashLoopBackOff", "restarts": 47, "age": "1h" }
  ],
  "deployments": [
    { "name": "nginx", "namespace": "default", "desired": 1, "ready": 1, "healthy": true, "age": "2d" },
    { "name": "broken-app", "namespace": "default", "desired": 1, "ready": 0, "healthy": false, "age": "1h" }
  ],
  "events": [
    { "namespace": "default", "reason": "BackOff", "message": "Back-off pulling image nginx:doesnotexist", "object": "Pod/broken-app-xxx", "count": 12, "last_seen": "2m" }
  ],
  "last_updated": "2026-04-23 19:00:00 UTC"
}
```

### API Response — `/api/summarize`

```json
{
  "summary": "Overall Status: DEGRADED — 3 of 5 deployments are unhealthy with active crash loops.\n\nIssues:\n- broken-app: ImagePullBackOff...\n\nRecommendation: Fix the broken image tag..."
}
```

---

## Architecture

```
Civo k3s Cluster (remote)
        │
        │  kubernetes Python client (kubeconfig)
        ▼
VPS (Flask + Gunicorn, port 5003) ──→ Anthropic API (Claude Haiku)
        │
        │  Nginx reverse proxy
        ▼
  k8s.ado-runner.com (Cloudflare SSL)
```

**Key design decisions:**
- Gunicorn binds to `127.0.0.1:5003` only — never exposed directly
- Nginx handles all public traffic; Cloudflare sits in front for SSL termination and DDoS protection
- Cluster queries run on-request (no background polling) — keeps the VPS lightweight
- AI digest is on-demand only, not scheduled — costs near zero during idle periods
- kubeconfig stored outside the repo (`.env` points to path on disk)

---

## Demo Workloads

The Civo cluster runs a mix of healthy and intentionally broken workloads to generate real events:

| Workload | Status | Purpose |
|---|---|---|
| `nginx` | Running ✅ | Healthy baseline |
| `broken-app` | ImagePullBackOff ❌ | Bad image tag (`nginx:doesnotexist`) |
| `crashloop-demo` | CrashLoopBackOff ❌ | Exits immediately on startup |
| `starved-pod` | Pending ⏳ | Requests 2Gi on a node with ~1.8Gi allocatable |

Deploy them:

```bash
kubectl create deployment nginx --image=nginx
kubectl create deployment broken-app --image=nginx:doesnotexist
kubectl create deployment crashloop-demo --image=busybox -- /bin/sh -c 'exit 1'
kubectl run starved-pod --image=nginx \
  --overrides='{"spec":{"containers":[{"name":"starved-pod","image":"nginx","resources":{"requests":{"memory":"2Gi"}}}]}}'
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Kubernetes integration | Python 3, `kubernetes` client |
| AI analysis | Anthropic Claude API (`claude-haiku-4-5`) |
| API server | Flask 3, Gunicorn |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Reverse proxy | Nginx |
| CDN / SSL | Cloudflare |
| Process management | systemd |
| OS / Hosting | Ubuntu 24.04 VPS |
| Cluster | Civo k3s (managed Kubernetes) |

---

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Live dashboard UI |
| `GET /api/cluster` | Full cluster state — nodes, pods, deployments, warning events |
| `GET /api/summarize` | On-demand Claude AI health digest |

---

## Setup

### 1. Clone & install dependencies

```bash
git clone https://github.com/ohdasdiego/k8s-event-summarizer.git
cd k8s-event-summarizer
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env — add your ANTHROPIC_API_KEY and KUBECONFIG path
```

### 3. Verify locally

```bash
# Start the app
python app.py
# → Dashboard at http://localhost:5003

# Or with gunicorn
gunicorn --bind 0.0.0.0:5003 app:app
```

### 4. Deploy as a systemd service

```bash
# Edit k8s-event-summarizer.service — replace YOUR_LINUX_USER with your username
sudo cp k8s-event-summarizer.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable k8s-event-summarizer
sudo systemctl start k8s-event-summarizer
```

### 5. Nginx reverse proxy

```bash
# Edit nginx.conf — replace the server_name with your domain
sudo cp nginx.conf /etc/nginx/sites-available/k8s-event-summarizer
sudo ln -s /etc/nginx/sites-available/k8s-event-summarizer /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Point Cloudflare DNS to your server IP with the orange cloud (proxied) enabled.

---

## Cost Analysis

Understanding API cost at scale is critical for production deployments. Claude Haiku pricing: $1.00/M input tokens, $5.00/M output tokens.

| Usage pattern | Calls/day | Est. cost/mo |
|---|---|---|
| 1 digest per hour | 24 | ~$0.04 |
| 1 digest per 15 min | 96 | ~$0.15 |
| 1 digest per 5 min | 288 | ~$0.45 |
| **On-demand only (current)** | **~5–10** | **< $0.01** |

> **Current config:** On-demand via the "Health Digest" button — costs near zero during idle periods. Add a `setInterval` call to `main.js` to switch to scheduled digests.

**Per-call breakdown:**
- ~120 input tokens (system prompt)
- ~350 input tokens (cluster snapshot)
- ~200 output tokens (structured digest)
- **~$0.001 per digest call**

---

## Skills Demonstrated

This project is intentionally production-aligned — not a local toy:

- **Kubernetes operations** — live cluster integration via Python client, multi-resource queries (nodes, pods, deployments, events), kubeconfig management
- **AI/API integration** — structured NOC-style prompting, operator-level output, error handling, API key hygiene
- **Observability engineering** — translating raw cluster state into operator-readable health digests with actionable recommendations
- **Linux systems ops** — systemd service management, process supervision, log routing
- **Network operations** — Nginx reverse proxy config, Cloudflare integration, port exposure management
- **Security hygiene** — secrets in `.env` (gitignored), gunicorn bound to loopback only, Cloudflare as the public face

---

## 🗺️ Roadmap

- [ ] Multi-namespace filtering — scope views to specific namespaces
- [ ] Scheduled auto-digest — configurable interval with history panel
- [ ] Slack/PagerDuty alerting — push notification when Claude detects critical state
- [ ] Event history with timestamps — rolling window of warning events
- [ ] PDF/JSON export of cluster health reports
- [ ] Integration with [ai-incident-logger](https://github.com/ohdasdiego/ai-incident-logger) — auto-create incidents on critical cluster events

---

## Author

**Diego Perez** · [github.com/ohdasdiego](https://github.com/ohdasdiego)
