const viewCopy = {
  home: [
    "Home",
    "Plain-language status for the assistant, files, WhatsApp, and storage."
  ],
  assistant: [
    "Assistant",
    "Control how the assistant responds and review file requests waiting on Vijayalakshmi."
  ],
  files: ["Files", "Index the local file repository and review what can be suggested."],
  chats: ["Chats", "See trusted WhatsApp chats and whether context is fresh."],
  sync: ["Sync", "Check message recovery and media download progress."],
  settings: ["Settings", "Runtime configuration and safety modes in one place."],
  logs: ["Logs", "Categorized events and raw Docker container logs for troubleshooting."]
};

function getInitialView() {
  const requested = new URLSearchParams(window.location.search).get("view");
  return requested && Object.prototype.hasOwnProperty.call(viewCopy, requested) ? requested : "home";
}

const state = {
  activeView: getInitialView(),
  apiFailures: [],
  data: {
    health: null,
    summary: null,
    storage: null,
    sync: null,
    backfill: null,
    media: null,
    conversations: null,
    confirmations: null,
    outbox: null,
    audit: null,
    resources: null,
    policy: null,
    containerLogs: null
  }
};

const refreshButton = document.querySelector("#refresh");
const themeToggleButton = document.querySelector("#theme-toggle");
const apiState = document.querySelector("#api-state");
const alertBox = document.querySelector("#alert");
const sidebarState = document.querySelector("#sidebar-state");
const quickStrip = document.querySelector("#quick-strip");
const THEME_STORAGE_KEY = "viji-dashboard-theme";
const DEFAULT_ASSISTANT_NAME = "Pratiksha";
const DEFAULT_ASSISTANT_REPLY_PREFIX = "[Pratiksha]";

const iconPaths = {
  home: '<path d="m3 10.5 9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="3"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M9 13v2"/><path d="M15 13v2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
  message: '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/>',
  sync: '<path d="M21 12a9 9 0 0 1-15.5 6.2"/><path d="M3 12A9 9 0 0 1 18.5 5.8"/><path d="M3 18h4v-4"/><path d="M21 6h-4v4"/>',
  settings: '<path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.4 7A2 2 0 1 1 7.2 4.2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 20 7.2l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.6 1Z"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  refresh: '<path d="M21 12a9 9 0 0 1-9 9 8.7 8.7 0 0 1-6-2.3"/><path d="M3 12a9 9 0 0 1 15-6.7"/><path d="M3 18h5v-5"/><path d="M21 6h-5v5"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m4.9 19.1 1.4-1.4"/><path d="m17.7 6.3 1.4-1.4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8 12 3 7 8"/><path d="M12 3v12"/>',
  sparkles: '<path d="M12 3 9.5 9.5 3 12l6.5 2.5L12 21l2.5-6.5L21 12l-6.5-2.5Z"/><path d="M19 3v4"/><path d="M21 5h-4"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  activity: '<path d="M22 12h-4l-3 8-6-16-3 8H2"/>',
  alert: '<path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  gauge: '<path d="M12 14 16 9"/><path d="M3.3 17a9 9 0 1 1 17.4 0"/><path d="M5 17h14"/>',
  hardDrive: '<path d="M22 12H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6Z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  layers: '<path d="m12 2 10 5-10 5L2 7Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 1 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 1 0 12 20.1l1.1-1.1"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a6 6 0 0 1-12 0V8Z"/>',
  route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h1a5 5 0 0 0 5-5V8"/><path d="M6 16V8a3 3 0 0 1 3-3h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  wifi: '<path d="M5 13a10 10 0 0 1 14 0"/><path d="M8.5 16.5a5 5 0 0 1 7 0"/><path d="M12 20h.01"/>',
  zap: '<path d="M13 2 3 14h8l-1 8 10-12h-8Z"/>'
};

function icon(name) {
  const path = iconPaths[name] || iconPaths.sparkles;
  return `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function decorateStaticIcons() {
  document.querySelectorAll("[data-icon]").forEach((element) => {
    if (element.querySelector(".icon")) {
      return;
    }

    element.insertAdjacentHTML("afterbegin", icon(element.dataset.icon));
  });
}

function iconLabel(name, label) {
  return `${icon(name)}<span>${label}</span>`;
}

function getStoredTheme() {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getPreferredTheme() {
  const requested = new URLSearchParams(window.location.search).get("theme");
  if (requested === "light" || requested === "dark") {
    return requested;
  }

  const stored = getStoredTheme();
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggleButton.innerHTML = iconLabel(theme === "dark" ? "sun" : "moon", theme === "dark" ? "Light mode" : "Dark mode");
  themeToggleButton.setAttribute("aria-pressed", String(theme === "dark"));

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // The dashboard still works if storage is unavailable.
  }
}

setTheme(getPreferredTheme());
decorateStaticIcons();

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatDate(value) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function formatBytes(value) {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let current = bytes;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }

  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDurationMs(value) {
  const ms = Number(value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) {
    return "unknown";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  }
  return `${(ms / 60_000).toFixed(ms < 600_000 ? 1 : 0)}m`;
}

function statusTone(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (
    normalized.includes("healthy") ||
    normalized.includes("ready") ||
    normalized.includes("available") ||
    normalized.includes("active") ||
    normalized.includes("auto") ||
    normalized.includes("downloaded") ||
    normalized.includes("sent") ||
    normalized.includes("ok")
  ) {
    return "ok";
  }

  if (
    normalized.includes("critical") ||
    normalized.includes("missing") ||
    normalized.includes("blocked") ||
    normalized.includes("failed") ||
    normalized.includes("paused") ||
    normalized.includes("error")
  ) {
    return "critical";
  }

  if (
    normalized.includes("warning") ||
    normalized.includes("unwritable") ||
    normalized.includes("queued") ||
    normalized.includes("running") ||
    normalized.includes("readonly") ||
    normalized.includes("attention") ||
    normalized.includes("waiting")
  ) {
    return "warn";
  }

  return "neutral";
}

function pill(value, tone = statusTone(value)) {
  return `<span class="pill ${tone}">${escapeHtml(value ?? "unknown")}</span>`;
}

function renderEmpty(text) {
  return `<div class="empty">${escapeHtml(text)}</div>`;
}

function table(headers, rows) {
  if (rows.length === 0) {
    return renderEmpty("Nothing to show.");
  }

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>
        </thead>
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function apiForm(path, formData) {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    body: formData
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error?.message || `Request failed: ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function loadAll() {
  refreshButton.disabled = true;
  apiState.className = "pill neutral";
  apiState.textContent = "Refreshing";

  const requests = {
    health: api("/health"),
    summary: api("/dashboard/summary"),
    storage: api("/storage/status"),
    sync: api("/sync/status?limit=10"),
    backfill: api("/backfill/status?limit=10"),
    media: api("/media/jobs?limit=25"),
    conversations: api("/conversations?limit=25"),
    confirmations: api("/confirmations?limit=25"),
    outbox: api("/outbox?limit=25"),
    audit: api("/audit?limit=50"),
    resources: api("/resources?limit=100"),
    policy: api("/policy?limit=50"),
    containerLogs: api("/container-logs?tail=120")
  };

  const entries = await Promise.allSettled(
    Object.entries(requests).map(async ([key, request]) => [key, await request])
  );

  const failures = [];
  for (const entry of entries) {
    if (entry.status === "fulfilled") {
      state.data[entry.value[0]] = entry.value[1];
    } else {
      failures.push(entry.reason?.message || "Unknown API failure");
    }
  }

  refreshButton.disabled = false;
  state.apiFailures = failures;
  apiState.className = failures.length === 0 ? "pill ok" : "pill warn";
  apiState.textContent = failures.length === 0 ? "Connected" : "Partial data";
  alertBox.classList.toggle("hidden", failures.length === 0);
  alertBox.textContent =
    failures.length === 0 ? "" : "Some dashboard data could not be loaded. Check API and Postgres.";
  render();
}

function getDashboardData() {
  const summary = state.data.summary || {};
  const status = summary.status || {};
  const storage = state.data.storage?.storage || status.storage || {};
  const runtime = summary.runtime || {};
  const counts = status.counts || {};

  return {
    status,
    storage,
    runtime,
    counts,
    conversations: toArray(state.data.conversations?.conversations),
    confirmations: toArray(state.data.confirmations?.confirmations),
    resources: toArray(state.data.resources?.resources),
    outbox: toArray(state.data.outbox?.jobs),
    syncRuns: toArray(state.data.sync?.syncRuns),
    backfillJobs: toArray(state.data.backfill?.backfillJobs),
    mediaJobs: toArray(state.data.media?.mediaJobs),
    auditEvents: toArray(state.data.audit?.auditEvents),
    policies: toArray(state.data.policy?.policies),
    containerLogs: state.data.containerLogs?.containerLogs || null
  };
}

function getAssistantName(data = getDashboardData()) {
  return data.runtime.assistantName || DEFAULT_ASSISTANT_NAME;
}

function getAssistantReplyPrefix(data = getDashboardData()) {
  return data.runtime.assistantReplyPrefix || DEFAULT_ASSISTANT_REPLY_PREFIX;
}

function getReadinessItems() {
  const data = getDashboardData();
  return [
    {
      label: "Assistant service",
      ok: state.data.health?.ok === true && data.status.database === "healthy",
      detail:
        state.data.health?.ok === true && data.status.database === "healthy"
          ? "Dashboard and database are reachable."
          : "Some assistant data could not be loaded."
    },
    {
      label: "External SSD",
      ok: data.storage.state === "healthy" || data.storage.state === "warning",
      detail: `${formatBytes(data.storage.usedBytes)} used of ${formatBytes(data.storage.quotaLimitBytes)}.`
    },
    {
      label: "WhatsApp setup",
      ok: data.runtime.wacliStoreConfigured === true,
      detail: data.runtime.liveSendEnabled ? "Live sending is enabled." : "Live sending is currently disabled."
    },
    {
      label: "Trusted chats",
      ok: data.conversations.length > 0,
      detail: `${data.conversations.length} trusted chat record${data.conversations.length === 1 ? "" : "s"}.`
    },
    {
      label: "File repository",
      ok: Boolean(data.runtime.resourceRoot),
      detail: `${data.resources.length} indexed file${data.resources.length === 1 ? "" : "s"}.`
    },
    {
      label: "Local AI",
      ok: Boolean(data.runtime.llmModel),
      detail: data.runtime.llmModel || "Model is not reported yet."
    }
  ];
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(number)));
}

function getStoragePercent(storage) {
  return Number(storage?.quotaLimitBytes) > 0
    ? clampPercent((Number(storage.usedBytes || 0) / Number(storage.quotaLimitBytes)) * 100)
    : 0;
}

function storageTone(storage) {
  const stateValue = String(storage?.state || "").toLowerCase();
  if (stateValue.includes("critical")) {
    return "critical";
  }
  if (stateValue.includes("warning")) {
    return "warn";
  }
  return "ok";
}

function countText(value) {
  return escapeHtml(Number(value || 0).toLocaleString());
}

function modeLabel(mode) {
  const normalized = String(mode || "auto");
  const labels = {
    auto: "Auto",
    confirm_resource: "Ask before files",
    readonly: "Read-only",
    paused: "Paused"
  };
  return labels[normalized] || normalized;
}

function briefText(value, fallback = "No detail yet.") {
  const text = String(value || fallback).trim();
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

function metricCard({ iconName, label, value, detail, tone = "info" }) {
  return `
    <section class="metric-card">
      <div class="metric-top">
        <div class="metric-icon">${icon(iconName)}</div>
        ${pill(tone === "ok" ? "Ready" : tone === "warn" ? "Watch" : tone === "critical" ? "Issue" : "Live", tone)}
      </div>
      <div>
        <div class="metric-value">${escapeHtml(value)}</div>
        <div class="metric-label">${escapeHtml(label)}</div>
      </div>
      <span>${escapeHtml(detail)}</span>
    </section>
  `;
}

function quickSignal({ iconName, label, value, tone = "neutral" }) {
  return `
    <div class="quick-signal">
      <div class="signal-icon">${icon(iconName)}</div>
      <div>
        <strong>${escapeHtml(value)}</strong>
        <span>${escapeHtml(label)}</span>
      </div>
      ${pill(tone === "ok" ? "OK" : tone === "warn" ? "Watch" : tone === "critical" ? "Fix" : "Live", tone)}
    </div>
  `;
}

function renderQuickStrip(data) {
  if (!quickStrip) {
    return;
  }

  const storagePercent = getStoragePercent(data.storage);
  quickStrip.innerHTML = [
    quickSignal({
      iconName: "database",
      label: "Postgres",
      value: data.status.database || (state.data.health?.ok ? "healthy" : "unknown"),
      tone: statusTone(data.status.database || "neutral")
    }),
    quickSignal({
      iconName: "wifi",
      label: "WhatsApp send",
      value: data.runtime.liveSendEnabled ? "enabled" : "disabled",
      tone: data.runtime.liveSendEnabled ? "ok" : "neutral"
    }),
    quickSignal({
      iconName: "folder",
      label: "Indexed files",
      value: `${data.resources.length}`,
      tone: data.resources.length > 0 ? "ok" : "warn"
    }),
    quickSignal({
      iconName: "hardDrive",
      label: "SSD allocation",
      value: `${storagePercent}% used`,
      tone: storageTone(data.storage)
    })
  ].join("");
}

function renderStatusRows(items) {
  return `
    <div class="status-list">
      ${items
        .map(
          (item) => `
            <div class="status-row with-icon">
              <div class="status-icon">${icon(item.ok ? "check" : "alert")}</div>
              <div>
                <div class="row-title">${escapeHtml(item.label)}</div>
                <div class="row-subtitle">${escapeHtml(item.detail)}</div>
              </div>
              ${pill(item.ok ? "Ready" : "Needs attention", item.ok ? "ok" : "warn")}
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderHome() {
  const data = getDashboardData();
  const assistantName = getAssistantName(data);
  const pending = data.confirmations.length;
  const blocked = data.outbox.filter((job) => job.state === "blocked").length;
  const storagePercent = getStoragePercent(data.storage);
  const attention = [
    state.apiFailures.length > 0 ? "Some dashboard data could not be loaded." : null,
    pending > 0 ? `${pending} file request${pending === 1 ? "" : "s"} waiting for Vijayalakshmi in WhatsApp.` : null,
    blocked > 0 ? `${blocked} blocked outbound item${blocked === 1 ? "" : "s"} need review.` : null,
    data.storage.state && data.storage.state !== "healthy" ? `Storage is ${data.storage.state}.` : null,
    data.status.database && data.status.database !== "healthy" ? "Database is not healthy." : null
  ].filter(Boolean);
  const heroReady = attention.length === 0 && data.status.database === "healthy";
  const latestAudit = data.auditEvents.slice(0, 3);

  return `
    <section class="hero-panel">
      <div class="hero-copy">
        <div>
          <p class="eyebrow" style="color: rgba(248, 251, 255, 0.78);">${escapeHtml(assistantName)} command</p>
          <h2>${heroReady ? `${escapeHtml(assistantName)} is ready.` : "One clear control room for the assistant."}</h2>
          <p>${heroReady ? "Text replies can run locally. File sends stay blocked until Vijayalakshmi confirms inside WhatsApp." : escapeHtml(attention[0] || "Review the live signals and finish the next action.")}</p>
        </div>
        <div class="hero-steps">
          ${pill("Local AI", "info")}
          ${pill("Postgres only", "ok")}
          ${pill("WhatsApp-only file approval", "warn")}
          ${pill(data.runtime.liveSendEnabled ? "Live send enabled" : "Live send disabled", data.runtime.liveSendEnabled ? "ok" : "neutral")}
        </div>
        <div class="button-row">
          <button class="button primary" data-view-shortcut="assistant">${iconLabel("shield", "Open controls")}</button>
          <button class="button" data-view-shortcut="logs">${iconLabel("terminal", "View logs")}</button>
        </div>
      </div>
      <div class="hero-metrics">
        <div class="hero-metric">
          <strong>${escapeHtml(data.conversations.length)}</strong>
          <span>trusted chats</span>
        </div>
        <div class="hero-metric">
          <strong>${escapeHtml(data.resources.length)}</strong>
          <span>indexed files</span>
        </div>
        <div class="hero-metric">
          <strong>${escapeHtml(pending)}</strong>
          <span>waiting approvals</span>
        </div>
        <div class="hero-metric">
          <strong>${escapeHtml(storagePercent)}%</strong>
          <span>storage allocation</span>
        </div>
      </div>
    </section>
    <div class="summary-grid">
      ${metricCard({
        iconName: "bot",
        label: "Assistant mode",
        value: modeLabel(data.runtime.defaultReplyMode),
        detail: data.runtime.autoReplyEnabled ? "Auto reply permission is enabled." : "Auto reply permission is disabled.",
        tone: data.runtime.autoReplyEnabled ? "ok" : "neutral"
      })}
      ${metricCard({
        iconName: "alert",
        label: "Needs attention",
        value: attention.length,
        detail: attention.length === 0 ? "No immediate action." : attention[0],
        tone: attention.length === 0 ? "ok" : "warn"
      })}
      ${metricCard({
        iconName: "folder",
        label: "File memory",
        value: countText(data.resources.length),
        detail: data.runtime.resourceRoot || "Repository path is not set.",
        tone: data.resources.length > 0 ? "ok" : "warn"
      })}
      ${metricCard({
        iconName: "activity",
        label: "Recent events",
        value: countText(data.auditEvents.length),
        detail: latestAudit[0] ? readableLog(latestAudit[0]) : "No recent audit events.",
        tone: data.auditEvents.length > 0 ? "info" : "neutral"
      })}
    </div>
    <div class="home-lanes">
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("check", "Setup checklist")}</h2>
          ${pill(data.storage.state || "unknown")}
        </div>
        ${renderStatusRows(getReadinessItems())}
      </section>
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("hardDrive", "SSD allocation")}</h2>
          <span class="muted">${storagePercent}% of allocation</span>
        </div>
        <div class="progress large" aria-label="Storage used">
          <div class="progress-fill ${storageTone(data.storage)}" style="--value: ${storagePercent}%"></div>
        </div>
        <p class="muted" style="margin-top: 10px;">${formatBytes(data.storage.usedBytes)} used. Free on SSD: ${formatBytes(data.storage.freeBytes)}.</p>
        <div style="margin-top: 14px;" class="grid two">
          <div>
            <h3>Next action</h3>
            <div class="status-list" style="margin-top: 10px;">
              ${
                attention.length === 0
                  ? `<div class="status-row"><div><div class="row-title">Keep watching</div><div class="row-subtitle">No manual control change is needed right now.</div></div>${pill("Clear", "ok")}</div>`
                  : attention
                      .slice(0, 2)
                      .map(
                        (item) => `
                          <div class="status-row">
                            <div>
                              <div class="row-title">${escapeHtml(item)}</div>
                              <div class="row-subtitle">Open the related section when you want to inspect details.</div>
                            </div>
                            ${pill("Check", "warn")}
                          </div>
                        `
                      )
                      .join("")
              }
            </div>
          </div>
          <div>
            <h3>Latest pulse</h3>
            <div class="timeline" style="margin-top: 10px;">
              ${
                latestAudit.length === 0
                  ? renderEmpty("No audit events yet.")
                  : latestAudit
                      .map(
                        (event) => `
                          <div class="timeline-item">
                            <span class="timeline-dot"></span>
                            <div>
                              <div class="row-title">${escapeHtml(readableLog(event))}</div>
                              <div class="row-subtitle">${formatDate(event.createdAt)}</div>
                            </div>
                          </div>
                        `
                      )
                      .join("")
              }
            </div>
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderAssistant() {
  const data = getDashboardData();
  const currentMode = String(data.runtime.defaultReplyMode || "auto");
  const modeButton = (mode, title, detail, iconName, tone = "") => `
    <button class="mode-button ${currentMode === mode ? "active primary" : ""} ${tone}" data-mode="${escapeHtml(mode)}">
      <strong>${iconLabel(iconName, title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </button>
  `;

  return `
    <div class="stack">
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("bot", "Response mode")}</h2>
            <p class="muted">Choose the operating behavior for allowlisted chats.</p>
          </div>
          ${pill(modeLabel(currentMode), statusTone(currentMode))}
        </div>
        <div class="mode-grid">
          ${modeButton("auto", "Auto", "Send safe text replies without owner approval.", "zap")}
          ${modeButton("confirm_resource", "Ask before files", "Suggest files, then wait for Vijayalakshmi in WhatsApp.", "shield")}
          ${modeButton("readonly", "Read-only", "Ingest and prepare context without sending replies.", "lock")}
          ${modeButton("paused", "Pause", "Stop assistant sends until you resume.", "clock", "danger")}
        </div>
      </section>
      <div class="summary-grid">
        ${metricCard({
          iconName: "send",
          label: "Live sending",
          value: data.runtime.liveSendEnabled ? "Enabled" : "Disabled",
          detail: "Controlled by runtime configuration.",
          tone: data.runtime.liveSendEnabled ? "ok" : "neutral"
        })}
        ${metricCard({
          iconName: "shield",
          label: "File approvals",
          value: "WhatsApp only",
          detail: "Dashboard users can deny, but cannot approve a send.",
          tone: "warn"
        })}
        ${metricCard({
          iconName: "database",
          label: "Local model",
          value: data.runtime.llmModel || "Unknown",
          detail: data.runtime.llmProvider || "ollama",
          tone: data.runtime.llmModel ? "ok" : "warn"
        })}
        ${metricCard({
          iconName: "message",
          label: "Trusted context",
          value: `${data.conversations.length}`,
          detail: "Fresh conversations improve replies.",
          tone: data.conversations.length > 0 ? "ok" : "warn"
        })}
      </div>
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("shield", "File requests waiting")}</h2>
            <p class="muted">This screen can deny a request. It cannot approve sending a file.</p>
          </div>
          ${pill("WhatsApp-only approval", "warn")}
        </div>
        ${
          data.confirmations.length === 0
            ? renderEmpty("No file request is waiting right now.")
            : `<div class="confirmation-grid">
                ${data.confirmations
                  .map(
                    (item) => `
                      <article class="confirmation-card">
                        <div class="resource-card-header">
                          <div>
                            <div class="row-title">${escapeHtml(item.recipientDisplayName || item.conversationTitle || "Vijayalakshmi")}</div>
                            <div class="row-subtitle">${escapeHtml(briefText(item.body || "Assistant asked for a confirmation."))}</div>
                          </div>
                          ${pill("Waiting in WhatsApp", "warn")}
                        </div>
                        <div class="button-row">
                          <button class="button danger" data-deny="${escapeHtml(item.agentDraftId)}">${iconLabel("alert", "Deny request")}</button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>`
        }
      </section>
    </div>
  `;
}

function renderFiles() {
  const data = getDashboardData();
  const rows = data.resources.map(
    (item) => `
      <tr>
        <td>${escapeHtml(item.registeredFileName || item.title || "unknown")}</td>
        <td>${escapeHtml(item.title || "Not named")}</td>
        <td>${escapeHtml(toArray(item.aliases).join(", ") || "None")}</td>
        <td>${pill(item.storageState || (item.isActive ? "available" : "inactive"))}</td>
      </tr>
    `
  );
  const resourceCards = data.resources.slice(0, 9).map((item) => {
    const aliases = toArray(item.aliases);
    return `
      <article class="resource-card">
        <div class="resource-card-header">
          <div class="resource-icon">${icon("file")}</div>
          ${pill(item.storageState || (item.isActive ? "available" : "inactive"))}
        </div>
        <div>
          <div class="resource-card-title">${escapeHtml(item.registeredFileName || item.title || "unknown")}</div>
          <div class="row-subtitle">${escapeHtml(item.title || "No friendly name yet")}</div>
        </div>
        <div class="resource-card-meta">
          ${
            aliases.length === 0
              ? pill("No aliases", "neutral")
              : aliases.slice(0, 3).map((alias) => pill(alias, "info")).join("")
          }
        </div>
      </article>
    `;
  });

  return `
    <div class="stack">
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("folder", "File repository")}</h2>
            <p class="muted">Drop files into the SSD repository, then let the assistant suggest close matches.</p>
          </div>
          <button class="button primary" id="index-resources">${iconLabel("sync", "Index files")}</button>
        </div>
        <div class="grid two">
          <div class="status-row">
            <div>
              <div class="row-title">Repository folder</div>
              <div class="row-subtitle path">${escapeHtml(data.runtime.resourceRoot || "not set")}</div>
            </div>
            ${pill(`${data.resources.length} indexed`, "info")}
          </div>
          <div class="status-row">
            <div>
              <div class="row-title">Matching behavior</div>
              <div class="row-subtitle">Exact names, aliases, and semantic matches can become WhatsApp suggestions.</div>
            </div>
            ${pill("Similarity enabled", "ok")}
          </div>
        </div>
      </section>
      <div class="file-workbench">
        <section class="panel upload-panel">
          <div class="panel-title-row">
            <div>
              <h2>${iconLabel("upload", "Upload a file")}</h2>
              <p class="muted">Upload into staged storage, then make it searchable.</p>
            </div>
            ${pill("WhatsApp confirmation still required", "info")}
          </div>
          <form id="resource-upload-form" class="upload-grid">
            <label class="upload-drop span-2" for="resource-upload-input">
              <input id="resource-upload-input" name="file" type="file" required />
              <span class="upload-emblem">${icon("sparkles")}</span>
              <strong>Drop a file here or choose from your Mac</strong>
              <span id="upload-file-name">PDFs, images, docs, sheets, and archives stay in the SSD repository.</span>
            </label>
            <label>Friendly name
              <input name="title" placeholder="Friendly file name" />
            </label>
            <label>Search words
              <input name="aliases" placeholder="comma-separated search words" />
            </label>
            <label class="span-2">Description
              <input name="description" placeholder="Optional note" />
            </label>
            <div class="button-row span-2">
              <button class="button primary" type="submit">${iconLabel("upload", "Upload and register")}</button>
            </div>
          </form>
        </section>
        <section class="panel">
          <div class="panel-title-row">
            <div>
              <h2>${iconLabel("file", "Register existing")}</h2>
              <p class="muted">For files you already placed under the repository.</p>
            </div>
          </div>
          <form id="resource-form" class="form-grid">
            <label class="span-2">Path inside repository
              <input name="path" placeholder="library/file-name.pdf" required />
            </label>
            <label>Friendly name
              <input name="title" placeholder="Friendly file name" />
            </label>
            <label>Search words
              <input name="aliases" placeholder="comma-separated search words" />
            </label>
            <label class="span-2">Description
              <input name="description" placeholder="Optional note to help matching" />
            </label>
            <div class="button-row span-2">
              <button class="button primary" type="submit">${iconLabel("check", "Register file")}</button>
            </div>
          </form>
        </section>
      </div>
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("layers", "Indexed files")}</h2>
            <p class="muted">Cards show the easiest matches first. The full table stays available below.</p>
          </div>
          ${pill(`${data.resources.length} total`, "info")}
        </div>
        ${
          resourceCards.length === 0
            ? renderEmpty("No indexed files yet. Upload a file or register an existing one.")
            : `<div class="resource-gallery">${resourceCards.join("")}</div>`
        }
        <div style="margin-top: 12px;">${table(["File", "Friendly name", "Search words", "State"], rows)}</div>
      </section>
    </div>
  `;
}

function renderChats() {
  const data = getDashboardData();
  const rows = data.conversations.map(
    (item) => `
      <tr>
        <td>${escapeHtml(item.title)}</td>
        <td>${escapeHtml(item.primaryContactDisplayName || "Unknown")}</td>
        <td>${pill(item.contextState === "fresh" ? "Ready" : item.contextState)}</td>
        <td>${formatDate(item.lastMessageAt)}</td>
      </tr>
    `
  );
  const cards = data.conversations.map(
    (item) => `
      <article class="chat-card">
        <div class="chat-card-header">
          <div class="chat-avatar">${icon("message")}</div>
          ${pill(item.contextState === "fresh" ? "Ready" : item.contextState)}
        </div>
        <div>
          <div class="chat-card-title">${escapeHtml(item.title || "Trusted chat")}</div>
          <div class="row-subtitle">${escapeHtml(item.primaryContactDisplayName || "Unknown contact")}</div>
        </div>
        <div class="status-row">
          <div>
            <div class="row-title">Last context update</div>
            <div class="row-subtitle">${formatDate(item.lastMessageAt)}</div>
          </div>
          ${pill(item.contextState === "fresh" ? "Fresh" : "Needs sync", item.contextState === "fresh" ? "ok" : "warn")}
        </div>
      </article>
    `
  );

  return `
    <div class="stack">
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("message", "Trusted chats")}</h2>
            <p class="muted">Fresh context means the assistant can reason from recent WhatsApp messages.</p>
          </div>
          ${pill(`${data.conversations.length} chats`, "info")}
        </div>
        ${
          cards.length === 0
            ? renderEmpty("No trusted chat has been imported yet.")
            : `<div class="chat-list">${cards.join("")}</div>`
        }
      </section>
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("database", "Chat records")}</h2>
          ${pill("Postgres source", "ok")}
        </div>
        ${table(["Chat", "Contact", "Context", "Last message"], rows)}
      </section>
    </div>
  `;
}

function renderSync() {
  const data = getDashboardData();
  const syncRows = data.syncRuns.map(
    (item) => `
      <tr>
        <td>${pill(item.state || "unknown")}</td>
        <td>${formatDate(item.startedAt)}</td>
        <td>${formatDate(item.finishedAt)}</td>
        <td>${escapeHtml(item.importedCount ?? item.importedMessages ?? 0)}</td>
      </tr>
    `
  );
  const mediaRows = data.mediaJobs.map(
    (item) => `
      <tr>
        <td>${escapeHtml(item.fileName || item.externalMessageId || item.messageMediaId)}</td>
        <td>${escapeHtml(item.mimeType || "unknown")}</td>
        <td>${formatBytes(item.sizeBytes)}</td>
        <td>${pill(item.state)}</td>
      </tr>
    `
  );
  const backfillRows = data.backfillJobs.map(
    (item) => `
      <tr>
        <td>${pill(item.state || "unknown")}</td>
        <td><code>${escapeHtml(item.conversationId || "unknown")}</code></td>
        <td>${formatDate(item.updatedAt || item.createdAt)}</td>
      </tr>
    `
  );

  return `
    <div class="stack">
      <div class="sync-lanes">
        <section class="sync-card">
          <div class="sync-card-header">
            <div>
              <h2>${iconLabel("sync", "Message sync")}</h2>
              <p class="muted">Recent import runs.</p>
            </div>
            ${pill(`${data.syncRuns.length}`, "info")}
          </div>
          <div class="status-list">
            ${
              data.syncRuns.length === 0
                ? renderEmpty("No sync runs yet.")
                : data.syncRuns.slice(0, 3).map((item) => `
                    <div class="status-row">
                      <div>
                        <div class="row-title">${escapeHtml(item.importedCount ?? item.importedMessages ?? 0)} messages</div>
                        <div class="row-subtitle">${formatDate(item.startedAt)}</div>
                      </div>
                      ${pill(item.state || "unknown")}
                    </div>
                  `).join("")
            }
          </div>
        </section>
        <section class="sync-card">
          <div class="sync-card-header">
            <div>
              <h2>${iconLabel("route", "History recovery")}</h2>
              <p class="muted">Reconnect and backfill jobs.</p>
            </div>
            ${pill(`${data.backfillJobs.length}`, "info")}
          </div>
          <div class="status-list">
            ${
              data.backfillJobs.length === 0
                ? renderEmpty("No recovery jobs yet.")
                : data.backfillJobs.slice(0, 3).map((item) => `
                    <div class="status-row">
                      <div>
                        <div class="row-title">${escapeHtml(item.conversationId || "Unknown chat")}</div>
                        <div class="row-subtitle">${formatDate(item.updatedAt || item.createdAt)}</div>
                      </div>
                      ${pill(item.state || "unknown")}
                    </div>
                  `).join("")
            }
          </div>
        </section>
        <section class="sync-card">
          <div class="sync-card-header">
            <div>
              <h2>${iconLabel("image", "Received media")}</h2>
              <p class="muted">Reusable uploads from WhatsApp.</p>
            </div>
            ${pill(`${data.mediaJobs.length}`, "info")}
          </div>
          <div class="status-list">
            ${
              data.mediaJobs.length === 0
                ? renderEmpty("No media downloads yet.")
                : data.mediaJobs.slice(0, 3).map((item) => `
                    <div class="status-row">
                      <div>
                        <div class="row-title">${escapeHtml(item.fileName || item.externalMessageId || "Media file")}</div>
                        <div class="row-subtitle">${escapeHtml(item.mimeType || "unknown")} ${formatBytes(item.sizeBytes)}</div>
                      </div>
                      ${pill(item.state || "unknown")}
                    </div>
                  `).join("")
            }
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("database", "Detailed sync records")}</h2>
          ${pill("Operational detail", "neutral")}
        </div>
        <div class="grid three">
          <div>${table(["State", "Started", "Finished", "Messages"], syncRows)}</div>
          <div>${table(["State", "Chat", "Updated"], backfillRows)}</div>
          <div>${table(["File", "Type", "Size", "State"], mediaRows)}</div>
        </div>
      </section>
    </div>
  `;
}

function renderSettings() {
  const data = getDashboardData();
  const assistantName = getAssistantName(data);
  const currentMode = String(data.runtime.defaultReplyMode || "auto");
  const liveSync = data.runtime.liveSync || data.status.live || {};
  const modeButton = (mode, title, detail, iconName, tone = "") => `
    <button class="mode-button ${currentMode === mode ? "active primary" : ""} ${tone}" data-mode="${escapeHtml(mode)}">
      <strong>${iconLabel(iconName, title)}</strong>
      <span>${escapeHtml(detail)}</span>
    </button>
  `;
  const policyRows = data.policies.map(
    (item) => `
      <tr>
        <td><code>${escapeHtml(item.contactId || "unknown")}</code></td>
        <td>${pill(item.mode)}</td>
      </tr>
    `
  );

  return `
    <div class="stack">
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("settings", "Control presets")}</h2>
            <p class="muted">Fast mode switches for the worker behavior.</p>
          </div>
          ${pill(modeLabel(currentMode), statusTone(currentMode))}
        </div>
        <div class="mode-grid">
          ${modeButton("auto", "Resume auto", "Use normal trusted-contact behavior.", "bot")}
          ${modeButton("confirm_resource", "Ask before files", "Keep file sends WhatsApp-confirmed.", "shield")}
          ${modeButton("readonly", "Read-only", "Do not send any replies.", "lock")}
          ${modeButton("paused", "Pause all", "Stop all assistant replies.", "clock", "danger")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("plug", "Runtime")}</h2>
          ${pill("Local first", "ok")}
        </div>
        <div class="runtime-grid">
          <div class="status-row with-icon"><div class="status-icon">${icon("bot")}</div><div><div class="row-title">Assistant identity</div><div class="row-subtitle">${escapeHtml(assistantName)} replies with ${escapeHtml(getAssistantReplyPrefix(data))}.</div></div>${pill("configured", "ok")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("zap")}</div><div><div class="row-title">Auto reply</div><div class="row-subtitle">Worker permission for automatic replies.</div></div>${pill(data.runtime.autoReplyEnabled ? "enabled" : "disabled")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("wifi")}</div><div><div class="row-title">Live sending</div><div class="row-subtitle">Whether real WhatsApp sends are enabled.</div></div>${pill(data.runtime.liveSendEnabled ? "enabled" : "disabled")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("sync")}</div><div><div class="row-title">Live sync cadence</div><div class="row-subtitle">Poll every ${escapeHtml(formatDurationMs(liveSync.pollIntervalMs))}; sync ${liveSync.syncBeforePollEnabled ? "before every poll" : `on startup and every ${formatDurationMs(liveSync.syncIntervalMs)}`}.</div></div>${pill(liveSync.syncSchedulerEnabled === false ? "sync off" : "scheduled", liveSync.syncBeforePollEnabled ? "warn" : "ok")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("image")}</div><div><div class="row-title">Media drain</div><div class="row-subtitle">Downloads up to ${escapeHtml(liveSync.mediaDrainLimitPerCycle ?? 3)} queued media item(s) per worker cycle; auto-promote ${liveSync.mediaAutoPromoteEnabled === false ? "off" : "on"}.</div></div>${pill(liveSync.mediaDrainEnabled === false ? "disabled" : "enabled", liveSync.mediaDrainEnabled === false ? "neutral" : "ok")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("database")}</div><div><div class="row-title">Local AI model</div><div class="row-subtitle">${escapeHtml(data.runtime.llmModel || "unknown")}</div></div>${pill(data.runtime.llmProvider || "ollama", "info")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("folder")}</div><div><div class="row-title">Media folder</div><div class="row-subtitle path">${escapeHtml(data.runtime.wacliMediaRoot || "unknown")}</div></div>${pill("configured", "neutral")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("hardDrive")}</div><div><div class="row-title">Resource folder</div><div class="row-subtitle path">${escapeHtml(data.runtime.resourceRoot || "unknown")}</div></div>${pill("SSD", "info")}</div>
          <div class="status-row with-icon"><div class="status-icon">${icon("lock")}</div><div><div class="row-title">File send authority</div><div class="row-subtitle">Only Vijayalakshmi can confirm from WhatsApp.</div></div>${pill("locked", "warn")}</div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-title-row">
          <h2>${iconLabel("shield", "Contact policies")}</h2>
          ${pill(`${data.policies.length} policies`, "info")}
        </div>
        ${table(["Contact", "Mode"], policyRows)}
      </section>
    </div>
  `;
}

function categorizeLog(event) {
  const type = String(event.type || "").toLowerCase();
  if (type.includes("resource") || type.includes("file") || type.includes("media")) {
    return "Files";
  }
  if (type.includes("policy") || type.includes("confirmation") || type.includes("deny")) {
    return "Safety";
  }
  if (type.includes("adapter") || type.includes("wacli") || type.includes("whatsapp")) {
    return "WhatsApp";
  }
  if (type.includes("agent") || type.includes("draft") || type.includes("llm") || type.includes("ai")) {
    return "AI";
  }
  if (type.includes("sync") || type.includes("backfill") || type.includes("cursor")) {
    return "Sync";
  }
  if (type.includes("storage") || type.includes("quota")) {
    return "Storage";
  }
  return "System";
}

function readableLog(event) {
  const type = String(event.type || "event").replaceAll(".", " ");
  const detail = event.detail || {};
  const parts = [
    detail.count !== undefined ? `${detail.count} item${detail.count === 1 ? "" : "s"}` : null,
    detail.scope ? `scope ${detail.scope}` : null,
    detail.resourceId ? "resource updated" : null,
    detail.errorCode ? `error ${detail.errorCode}` : null
  ].filter(Boolean);
  return parts.length > 0 ? `${type}: ${parts.join(", ")}` : type;
}

function renderContainerLogServices(containerLogs) {
  const services = toArray(containerLogs?.services);
  if (!containerLogs?.enabled) {
    return renderEmpty(containerLogs?.unavailableReason || "Container logs are not enabled.");
  }

  return `
    <div class="container-log-toolbar">
      <button class="chip ${containerLogs.selectedService === "all" ? "active" : ""}" data-container-log-service="all">
        All containers
      </button>
      ${services
        .map(
          (service) => `
            <button class="chip ${containerLogs.selectedService === service.service ? "active" : ""}" data-container-log-service="${escapeHtml(service.service)}">
              ${escapeHtml(service.service)}
              <span>${escapeHtml(service.state)}</span>
            </button>
          `
        )
        .join("")}
    </div>
  `;
}

function renderRawLogStream(containerLogs) {
  if (!containerLogs?.enabled) {
    return renderEmpty(containerLogs?.unavailableReason || "Container logs are unavailable.");
  }

  if (containerLogs.unavailableReason) {
    return renderEmpty(containerLogs.unavailableReason);
  }

  if (!containerLogs.rawText) {
    return renderEmpty("No recent container logs are available.");
  }

  return `
    <div class="raw-log-stream" aria-label="Raw Docker container logs">
      <div class="raw-log-line">${escapeHtml(containerLogs.rawText)}</div>
    </div>
  `;
}

function renderLogs() {
  const data = getDashboardData();
  const categories = ["Safety", "Files", "WhatsApp", "AI", "Sync", "Storage", "System"];
  const grouped = Object.fromEntries(categories.map((category) => [category, []]));
  for (const event of data.auditEvents) {
    grouped[categorizeLog(event)].push(event);
  }
  const categoryIcons = {
    Safety: "shield",
    Files: "folder",
    WhatsApp: "message",
    AI: "bot",
    Sync: "sync",
    Storage: "hardDrive",
    System: "activity"
  };

  return `
    <div class="stack">
      <section class="panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("terminal", "Logs by category")}</h2>
            <p class="muted">Categorized first, raw container output below for deep troubleshooting.</p>
          </div>
          ${pill(`${data.auditEvents.length} events`, "info")}
        </div>
        <div class="log-groups">
          ${categories
            .map((category) => {
              const events = grouped[category];
              return `
                <div class="log-row">
                  <div class="log-category-header">
                    <div class="log-icon">${icon(categoryIcons[category])}</div>
                    <div>
                      <div class="row-title">${escapeHtml(category)}</div>
                      <div class="row-subtitle">${events.length === 0 ? "No recent events." : escapeHtml(readableLog(events[0]))}</div>
                    </div>
                    ${pill(`${events.length}`, events.length === 0 ? "neutral" : "info")}
                  </div>
                  ${
                    events.length === 0
                      ? ""
                      : `<details>
                          <summary>Show recent ${escapeHtml(category.toLowerCase())} events</summary>
                          ${table(
                            ["Time", "Level", "Event", "Details"],
                            events.map(
                              (event) => `
                                <tr>
                                  <td>${formatDate(event.createdAt)}</td>
                                  <td>${pill(event.severity || "info")}</td>
                                  <td>${escapeHtml(readableLog(event))}</td>
                                  <td><code>${escapeHtml(JSON.stringify(event.detail || {}))}</code></td>
                                </tr>
                              `
                            )
                          )}
                        </details>`
                  }
                </div>
              `;
            })
            .join("")}
        </div>
      </section>
      <section class="panel raw-log-panel">
        <div class="panel-title-row">
          <div>
            <h2>${iconLabel("terminal", "Raw container logs")}</h2>
            <p class="muted">Each container log stream stays here, last in navigation, with no normal controls mixed in.</p>
          </div>
          ${pill(data.containerLogs?.project || "docker", "neutral")}
        </div>
        ${renderContainerLogServices(data.containerLogs)}
        <div class="log-meta">
          <span>Selected: ${escapeHtml(data.containerLogs?.selectedService || "all")}</span>
          <span>Tail: ${escapeHtml(data.containerLogs?.tail || 120)} lines</span>
          <span>Updated: ${formatDate(data.containerLogs?.generatedAt)}</span>
        </div>
        ${renderRawLogStream(data.containerLogs)}
      </section>
    </div>
  `;
}

function render() {
  const [title, subtitle] = viewCopy[state.activeView];
  const data = getDashboardData();
  const assistantName = getAssistantName(data);
  const brandTitle = document.querySelector(".brand-title");
  const brandMark = document.querySelector(".brand-mark");
  if (brandTitle) {
    brandTitle.textContent = assistantName;
  }
  if (brandMark) {
    brandMark.textContent = assistantName.slice(0, 1).toUpperCase();
  }
  document.querySelector("#view-title").textContent = title;
  document.querySelector("#view-subtitle").textContent = subtitle;
  document.body.dataset.view = state.activeView;
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.toggle("active", item.dataset.view === state.activeView));
  if (sidebarState) {
    const label =
      state.apiFailures.length > 0
        ? "Partial data"
        : data.status.database === "healthy"
          ? "Connected"
          : state.data.health?.ok
            ? "API online"
            : "Waiting";
    sidebarState.textContent = label;
  }
  renderQuickStrip(data);

  const renderers = {
    home: renderHome,
    assistant: renderAssistant,
    files: renderFiles,
    chats: renderChats,
    sync: renderSync,
    settings: renderSettings,
    logs: renderLogs
  };

  for (const [view, renderView] of Object.entries(renderers)) {
    const element = document.querySelector(`#view-${view}`);
    element.classList.toggle("active", view === state.activeView);
    if (view === state.activeView) {
      element.innerHTML = renderView();
    }
  }
}

async function setPolicyMode(mode) {
  await api("/policy/mode", {
    method: "POST",
    body: { mode }
  });
  await loadAll();
}

async function denyConfirmation(agentDraftId) {
  await api(`/confirmations/${encodeURIComponent(agentDraftId)}/deny`, {
    method: "POST",
    body: {}
  });
  await loadAll();
}

async function indexResources() {
  await api("/resources/index", {
    method: "POST",
    body: { scope: "library", limit: 100 }
  });
  await loadAll();
}

async function loadContainerLogs(service = "all") {
  state.data.containerLogs = await api(
    `/container-logs?service=${encodeURIComponent(service)}&tail=120`
  );
  render();
}

async function registerResource(form) {
  const formData = new FormData(form);
  const aliases = String(formData.get("aliases") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  await api("/resources/register", {
    method: "POST",
    body: {
      path: String(formData.get("path") || ""),
      title: String(formData.get("title") || "") || undefined,
      aliases,
      description: String(formData.get("description") || "") || null
    }
  });
  form.reset();
  await loadAll();
}

async function uploadResource(form) {
  const formData = new FormData(form);
  const file = formData.get("file");
  if (!file || typeof file === "string" || file.size === 0) {
    throw new Error("Choose a non-empty file to upload.");
  }

  await apiForm("/resources/upload", formData);
  form.reset();
  const fileName = document.querySelector("#upload-file-name");
  if (fileName) {
    fileName.textContent = "PDFs, images, docs, sheets, and archives stay in the SSD repository.";
  }
  await loadAll();
}

document.querySelector(".nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (!button) {
    return;
  }

  state.activeView = button.dataset.view;
  document
    .querySelectorAll(".nav-item")
    .forEach((item) => item.classList.toggle("active", item === button));
  render();
});

document.addEventListener("click", async (event) => {
  const modeButton = event.target.closest("[data-mode]");
  const denyButton = event.target.closest("[data-deny]");
  const indexButton = event.target.closest("#index-resources");
  const shortcutButton = event.target.closest("[data-view-shortcut]");
  const containerLogButton = event.target.closest("[data-container-log-service]");

  try {
    if (containerLogButton) {
      await loadContainerLogs(containerLogButton.dataset.containerLogService);
    } else if (shortcutButton) {
      const targetView = shortcutButton.dataset.viewShortcut;
      const navButton = document.querySelector(`[data-view="${targetView}"]`);
      if (navButton) {
        navButton.click();
      }
    } else if (modeButton) {
      await setPolicyMode(modeButton.dataset.mode);
    } else if (denyButton) {
      await denyConfirmation(denyButton.dataset.deny);
    } else if (indexButton) {
      await indexResources();
    }
  } catch (error) {
    alertBox.classList.remove("hidden");
    alertBox.textContent = error.message;
  }
});

document.addEventListener("submit", async (event) => {
  if (event.target.id !== "resource-form" && event.target.id !== "resource-upload-form") {
    return;
  }

  event.preventDefault();
  try {
    if (event.target.id === "resource-upload-form") {
      await uploadResource(event.target);
    } else {
      await registerResource(event.target);
    }
  } catch (error) {
    alertBox.classList.remove("hidden");
    alertBox.textContent = error.message;
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id !== "resource-upload-input") {
    return;
  }

  const fileName = document.querySelector("#upload-file-name");
  const file = event.target.files?.[0];
  if (fileName && file) {
    fileName.textContent = `${file.name} · ${formatBytes(file.size)}`;
  }
});

document.addEventListener("dragover", (event) => {
  const drop = event.target.closest(".upload-drop");
  if (!drop) {
    return;
  }

  event.preventDefault();
  drop.classList.add("dragging");
});

document.addEventListener("dragleave", (event) => {
  const drop = event.target.closest(".upload-drop");
  if (drop) {
    drop.classList.remove("dragging");
  }
});

document.addEventListener("drop", (event) => {
  const drop = event.target.closest(".upload-drop");
  const input = document.querySelector("#resource-upload-input");
  if (!drop || !input || !event.dataTransfer?.files?.length) {
    return;
  }

  event.preventDefault();
  input.files = event.dataTransfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  drop.classList.remove("dragging");
});

refreshButton.addEventListener("click", () => {
  loadAll().catch((error) => {
    alertBox.classList.remove("hidden");
    alertBox.textContent = error.message;
  });
});

themeToggleButton.addEventListener("click", () => {
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
});

render();
loadAll().catch((error) => {
  apiState.className = "pill critical";
  apiState.textContent = "Unavailable";
  alertBox.classList.remove("hidden");
  alertBox.textContent = error.message;
});
