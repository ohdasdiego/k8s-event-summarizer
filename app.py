from flask import Flask, render_template, jsonify
from kubernetes import client, config
import anthropic
import os
from datetime import datetime, timezone
from collections import defaultdict

app = Flask(__name__)

# Load kubeconfig
try:
    config.load_incluster_config()
except:
    config.load_kube_config()

v1 = client.CoreV1Api()
apps_v1 = client.AppsV1Api()
anthropic_client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))


def get_nodes():
    nodes = []
    for node in v1.list_node().items:
        conditions = {c.type: c.status for c in node.status.conditions}
        ready = conditions.get("Ready", "Unknown") == "True"
        allocatable = node.status.allocatable or {}
        nodes.append({
            "name": node.metadata.name,
            "status": "Ready" if ready else "NotReady",
            "cpu": allocatable.get("cpu", "N/A"),
            "memory": allocatable.get("memory", "N/A"),
            "version": node.status.node_info.kubelet_version,
            "age": _age(node.metadata.creation_timestamp),
        })
    return nodes


def get_pods():
    pods = []
    for pod in v1.list_pod_for_all_namespaces().items:
        phase = pod.status.phase or "Unknown"
        # Check for problematic container states
        status_detail = phase
        if pod.status.container_statuses:
            for cs in pod.status.container_statuses:
                if cs.state.waiting:
                    status_detail = cs.state.waiting.reason or phase
                    break
        pods.append({
            "name": pod.metadata.name,
            "namespace": pod.metadata.namespace,
            "status": status_detail,
            "ready": _pod_ready(pod),
            "restarts": _restart_count(pod),
            "age": _age(pod.metadata.creation_timestamp),
        })
    return pods


def get_deployments():
    deployments = []
    for d in apps_v1.list_deployment_for_all_namespaces().items:
        desired = d.spec.replicas or 0
        ready = d.status.ready_replicas or 0
        deployments.append({
            "name": d.metadata.name,
            "namespace": d.metadata.namespace,
            "desired": desired,
            "ready": ready,
            "healthy": ready == desired,
            "age": _age(d.metadata.creation_timestamp),
        })
    return deployments


def get_events(limit=50):
    events = []
    field_selector = "type=Warning"
    for e in v1.list_event_for_all_namespaces(field_selector=field_selector, limit=limit).items:
        events.append({
            "namespace": e.metadata.namespace,
            "reason": e.reason or "Unknown",
            "message": e.message or "",
            "object": f"{e.involved_object.kind}/{e.involved_object.name}",
            "count": e.count or 1,
            "last_seen": _age(e.last_timestamp or e.event_time),
        })
    # Sort by most recent
    return events[:20]


def summarize_cluster(nodes, pods, deployments, events):
    warning_pods = [p for p in pods if p["status"] not in ("Running", "Succeeded", "Completed")]
    unhealthy_deployments = [d for d in deployments if not d["healthy"]]

    cluster_snapshot = f"""
CLUSTER SNAPSHOT:
Nodes: {len(nodes)} total, {sum(1 for n in nodes if n['status'] == 'Ready')} ready
Pods: {len(pods)} total, {sum(1 for p in pods if p['status'] == 'Running')} running, {len(warning_pods)} unhealthy
Deployments: {len(deployments)} total, {len(unhealthy_deployments)} unhealthy

UNHEALTHY PODS:
{chr(10).join(f"- {p['namespace']}/{p['name']}: {p['status']} (restarts: {p['restarts']})" for p in warning_pods) or "None"}

UNHEALTHY DEPLOYMENTS:
{chr(10).join(f"- {d['namespace']}/{d['name']}: {d['ready']}/{d['desired']} replicas ready" for d in unhealthy_deployments) or "None"}

RECENT WARNING EVENTS:
{chr(10).join(f"- [{e['reason']}] {e['object']}: {e['message'][:120]} (seen {e['count']}x)" for e in events[:10]) or "None"}
"""

    response = anthropic_client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=600,
        system="""You are a Kubernetes NOC assistant. Given a cluster snapshot, write a concise plain-English health digest.
Structure your response as:
1. Overall Status (one sentence: healthy/degraded/critical)
2. Issues (bullet list, only if any exist)
3. Recommendation (one actionable sentence)
Be direct. No filler. Use operator-level language.""",
        messages=[{"role": "user", "content": cluster_snapshot}]
    )
    return response.content[0].text


# --- Helpers ---

def _age(ts):
    if ts is None:
        return "N/A"
    now = datetime.now(timezone.utc)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    diff = now - ts
    s = int(diff.total_seconds())
    if s < 60: return f"{s}s"
    if s < 3600: return f"{s//60}m"
    if s < 86400: return f"{s//3600}h"
    return f"{s//86400}d"


def _pod_ready(pod):
    if not pod.status.container_statuses:
        return False
    return all(cs.ready for cs in pod.status.container_statuses)


def _restart_count(pod):
    if not pod.status.container_statuses:
        return 0
    return sum(cs.restart_count for cs in pod.status.container_statuses)


# --- Routes ---

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/cluster")
def cluster_data():
    try:
        nodes = get_nodes()
        pods = get_pods()
        deployments = get_deployments()
        events = get_events()
        return jsonify({
            "nodes": nodes,
            "pods": pods,
            "deployments": deployments,
            "events": events,
            "last_updated": datetime.now().strftime("%Y-%m-%d %H:%M:%S UTC"),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/summarize")
def summarize():
    try:
        nodes = get_nodes()
        pods = get_pods()
        deployments = get_deployments()
        events = get_events()
        summary = summarize_cluster(nodes, pods, deployments, events)
        return jsonify({"summary": summary})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5003, debug=False)
