let allPods = [];
let currentFilter = 'all';

const DIGEST_BTN_LABEL = '⚡ Health Digest';

async function loadClusterData() {
  const btn = document.getElementById('refresh-btn');
  btn.textContent = '↻ Loading…';
  btn.disabled = true;

  try {
    const res = await fetch('/api/cluster');
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    allPods = data.pods;
    renderNodes(data.nodes);
    renderDeployments(data.deployments);
    renderPods(allPods);
    renderEvents(data.events);
    renderStats(data);

    document.getElementById('last-updated').textContent = data.last_updated;
  } catch (e) {
    console.error(e);
  } finally {
    btn.textContent = '↻ Refresh';
    btn.disabled = false;
  }
}

async function getDigest() {
  const btn   = document.getElementById('digest-btn');
  const panel = document.getElementById('digest-panel');
  const body  = document.getElementById('digest-body');

  btn.textContent = '⚡ Analyzing…';
  btn.disabled = true;
  panel.style.display = 'block';
  body.textContent = 'Analyzing cluster state…';

  try {
    const res  = await fetch('/api/summarize');
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    body.textContent = data.summary;
    document.getElementById('digest-ts').textContent =
      new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    body.textContent = 'Error: ' + e.message;
  } finally {
    btn.textContent = DIGEST_BTN_LABEL;
    btn.disabled = false;
  }
}

function renderStats(data) {
  const { nodes, pods, deployments, events } = data;
  const readyNodes     = nodes.filter(n => n.status === 'Ready').length;
  const runningPods    = pods.filter(p => p.status === 'Running').length;
  const warnPods       = pods.filter(p => !['Running','Succeeded','Completed'].includes(p.status)).length;
  const healthyDeploys = deployments.filter(d => d.healthy).length;

  setStatCard('stat-nodes',        `${readyNodes}/${nodes.length}`,         readyNodes === nodes.length ? 'ok' : 'warn');
  setStatCard('stat-pods-running', runningPods,                             '');
  setStatCard('stat-pods-warn',    warnPods,                                warnPods > 0 ? 'warn' : 'ok');
  setStatCard('stat-deployments',  `${healthyDeploys}/${deployments.length}`, healthyDeploys === deployments.length ? 'ok' : 'warn');
  setStatCard('stat-events',       events.length,                           events.length > 0 ? 'warn' : 'ok');
}

function setStatCard(id, value, cls) {
  const el = document.getElementById(id);
  el.querySelector('.stat-value').textContent = value;
  el.querySelector('.stat-value').className = `stat-value ${cls === 'ok' ? 'ok' : cls === 'warn' ? 'warn' : 'neutral'}`;
  el.className = `stat-card ${cls}`;
}

function renderNodes(nodes) {
  document.getElementById('node-count').textContent = nodes.length;
  const tbody = document.getElementById('nodes-tbody');
  if (!nodes.length) { tbody.innerHTML = emptyRow(6, 'No nodes found'); return; }
  tbody.innerHTML = nodes.map(n => `
    <tr>
      <td class="td-name">${n.name}</td>
      <td>${badge(n.status, n.status === 'Ready' ? 'green' : 'red')}</td>
      <td class="td-muted">${n.cpu}</td>
      <td class="td-muted">${formatMemory(n.memory)}</td>
      <td class="td-muted">${n.version}</td>
      <td class="td-muted">${n.age}</td>
    </tr>`).join('');
}

function renderDeployments(deployments) {
  document.getElementById('deploy-count').textContent = deployments.length;
  const tbody = document.getElementById('deployments-tbody');
  if (!deployments.length) { tbody.innerHTML = emptyRow(5, 'No deployments found'); return; }
  tbody.innerHTML = deployments.map(d => `
    <tr>
      <td class="td-name">${d.name}</td>
      <td class="td-muted">${d.namespace}</td>
      <td class="td-muted">${d.ready}/${d.desired}</td>
      <td>${badge(d.healthy ? 'Healthy' : 'Degraded', d.healthy ? 'green' : 'red')}</td>
      <td class="td-muted">${d.age}</td>
    </tr>`).join('');
}

function renderPods(pods) {
  document.getElementById('pod-count').textContent = pods.length;
  const tbody = document.getElementById('pods-tbody');

  let filtered = pods;
  if (currentFilter === 'warn')    filtered = pods.filter(p => !['Running','Succeeded','Completed'].includes(p.status));
  if (currentFilter === 'default') filtered = pods.filter(p => p.namespace === 'default');

  if (!filtered.length) { tbody.innerHTML = emptyRow(5, 'No pods match filter'); return; }

  tbody.innerHTML = filtered.map(p => `
    <tr>
      <td class="td-name">${p.name}</td>
      <td class="td-muted">${p.namespace}</td>
      <td>${podStatusBadge(p.status)}</td>
      <td style="color:${p.restarts > 5 ? 'var(--red)' : p.restarts > 0 ? 'var(--yellow)' : 'var(--muted2)'}">${p.restarts}</td>
      <td class="td-muted">${p.age}</td>
    </tr>`).join('');
}

function renderEvents(events) {
  document.getElementById('event-count').textContent = events.length;
  const tbody = document.getElementById('events-tbody');
  if (!events.length) { tbody.innerHTML = emptyRow(5, 'No warning events'); return; }
  tbody.innerHTML = events.map(e => `
    <tr>
      <td class="td-name">${e.object}</td>
      <td>${badge(e.reason, reasonColor(e.reason))}</td>
      <td class="td-msg" title="${esc(e.message)}">${esc(e.message)}</td>
      <td style="color:${e.count > 10 ? 'var(--red)' : 'var(--muted2)'}">${e.count}</td>
      <td class="td-muted">${e.last_seen}</td>
    </tr>`).join('');
}

function filterPods(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderPods(allPods);
}

// ── Helpers ──

function badge(text, color) {
  return `<span class="badge badge-${color}">${text}</span>`;
}

function podStatusBadge(status) {
  const map = {
    'Running': 'green', 'Completed': 'dim', 'Succeeded': 'dim',
    'Pending': 'yellow', 'ImagePullBackOff': 'red', 'ErrImagePull': 'red',
    'CrashLoopBackOff': 'red', 'Error': 'red', 'OOMKilled': 'red',
  };
  return badge(status, map[status] || 'orange');
}

function reasonColor(reason) {
  if (['BackOff','Failed','OOMKilling','Evicted'].includes(reason)) return 'red';
  if (['FailedScheduling','Unhealthy'].includes(reason)) return 'yellow';
  return 'orange';
}

function formatMemory(mem) {
  if (!mem || mem === 'N/A') return 'N/A';
  const ki = parseInt(mem);
  if (isNaN(ki)) return mem;
  return (ki / 1024 / 1024).toFixed(1) + ' GiB';
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" class="empty-row">${msg}</td></tr>`;
}

function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Auto-load on page open + refresh every 30s
loadClusterData();
setInterval(loadClusterData, 30000);
