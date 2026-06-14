const elements = {
  enabled: document.querySelector("#enabled"),
  blocked: document.querySelector("#blocked"),
  scanned: document.querySelector("#scanned"),
  decisionCount: document.querySelector("#decisionCount"),
  model: document.querySelector("#model"),
  threshold: document.querySelector("#threshold"),
  hideMode: document.querySelector("#hideMode"),
  events: document.querySelector("#events"),
  toast: document.querySelector("#toast"),
  openOptions: document.querySelector("#openOptions"),
  exportData: document.querySelector("#exportData"),
  clearCache: document.querySelector("#clearCache")
};

init();

async function init() {
  await refresh();

  elements.enabled.addEventListener("change", async () => {
    const response = await send("SAVE_SETTINGS", { enabled: elements.enabled.checked });
    showToast(response.ok ? "已更新" : response.error);
  });

  elements.openOptions.addEventListener("click", () => chrome.runtime.openOptionsPage());
  elements.exportData.addEventListener("click", exportData);
  elements.clearCache.addEventListener("click", clearCache);
}

async function refresh() {
  const response = await send("GET_STATUS");
  if (!response.ok) {
    showToast(response.error || "读取状态失败");
    return;
  }
  render(response);
}

function render(status) {
  const settings = status.settings;
  const stats = status.stats || {};
  elements.enabled.checked = Boolean(settings.enabled);
  elements.blocked.textContent = String(stats.blocked || 0);
  elements.scanned.textContent = String(stats.scanned || 0);
  elements.decisionCount.textContent = String(status.decisionCount || 0);
  elements.model.textContent = settings.model || "未配置";
  elements.threshold.textContent = `${Math.round(settings.threshold * 100)}%`;
  elements.hideMode.textContent = modeLabel(settings.hideMode);
  renderEvents(status.events || []);
}

function renderEvents(events) {
  if (!events.length) {
    elements.events.className = "events empty";
    elements.events.textContent = "暂无记录";
    return;
  }

  elements.events.className = "events";
  elements.events.innerHTML = events
    .slice(0, 6)
    .map((event) => {
      const blocked = event.type === "blocked";
      const author = escapeHtml(event.author?.name || event.author?.url || "未知作者");
      const score = Number.isFinite(event.decision?.score) ? Math.round(event.decision.score * 100) : 0;
      const reason = escapeHtml(event.decision?.reason || event.error || event.source || "");
      return `
        <article class="event">
          <div class="event-title">
            <span>${author}</span>
            <span>${blocked ? "挡下" : "放行"} ${score}</span>
          </div>
          <small>${reason}</small>
        </article>
      `;
    })
    .join("");
}

async function exportData() {
  const response = await send("EXPORT_DATA");
  if (!response.ok) {
    showToast(response.error || "导出失败");
    return;
  }
  const blob = new Blob([JSON.stringify(response, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `zhihu-ai-shield-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast("已导出");
}

async function clearCache() {
  const response = await send("CLEAR_CACHE");
  showToast(response.ok ? "缓存已清空" : response.error);
  await refresh();
}

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function modeLabel(mode) {
  return {
    rewrite: "改写占位",
    collapse: "折叠",
    hide: "隐藏",
    blur: "模糊"
  }[mode] || mode;
}

function showToast(text) {
  elements.toast.textContent = text || "";
  if (text) setTimeout(() => (elements.toast.textContent = ""), 2200);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
