const statusPanel = document.getElementById("status-panel");

function adminHeaders() {
  const key = localStorage.getItem("monkey-radio-admin-key");
  return key ? { "x-admin-key": key } : {};
}

export function getAdminHeaders() {
  return adminHeaders();
}

function statusClass(ok) {
  return ok ? "status-ok" : "status-warn";
}

function formatCounts(counts) {
  if (!counts) return "—";
  return Object.entries(counts)
    .map(([genre, count]) => `${genre}: ${count}`)
    .join(" · ");
}

async function refreshStatus() {
  if (!statusPanel) return;

  try {
    const response = await fetch("/api/status");
    const data = await response.json();

    statusPanel.innerHTML = `
      <div class="status-grid">
        <div class="status-item ${statusClass(data.broadcast?.fresh)}">
          <span class="status-label">Broadcast</span>
          <span class="status-value">${
            data.broadcast?.active
              ? `${data.broadcast.phase ?? "—"} · ${data.broadcast.track?.title ?? "—"}`
              : "Offline"
          }</span>
        </div>
        <div class="status-item ${statusClass(data.library?.healthy)}">
          <span class="status-label">Library</span>
          <span class="status-value">${formatCounts(data.library?.readyCounts)}</span>
        </div>
        <div class="status-item ${statusClass(data.stream?.rtmpConfigured)}">
          <span class="status-label">Stream</span>
          <span class="status-value">${
            data.stream?.rtmpConfigured ? "RTMP configured" : "RTMP not set"
          }</span>
        </div>
        <div class="status-item">
          <span class="status-label">Chat</span>
          <span class="status-value">${data.chat?.provider ?? "—"}</span>
        </div>
        <div class="status-item ${statusClass(data.cdn?.libraryUrl)}">
          <span class="status-label">CDN</span>
          <span class="status-value">${
            data.cdn?.libraryUrl ? "Library on CDN" : "Local only"
          }</span>
        </div>
      </div>
    `;
  } catch {
    statusPanel.innerHTML =
      '<p class="status-error">Cannot reach /api/status</p>';
  }
}

export function initStatusPanel() {
  const keyInput = document.getElementById("admin-key-input");
  const saveBtn = document.getElementById("admin-key-save");

  if (keyInput) {
    keyInput.value = localStorage.getItem("monkey-radio-admin-key") ?? "";
  }

  saveBtn?.addEventListener("click", () => {
    const value = keyInput?.value.trim() ?? "";
    if (value) {
      localStorage.setItem("monkey-radio-admin-key", value);
    } else {
      localStorage.removeItem("monkey-radio-admin-key");
    }
  });

  void refreshStatus();
  setInterval(refreshStatus, 10_000);
}
