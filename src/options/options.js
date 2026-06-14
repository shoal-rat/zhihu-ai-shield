const fields = {
  enabled: document.querySelector("#enabled"),
  aiEnabled: document.querySelector("#aiEnabled"),
  fetchRecentContent: document.querySelector("#fetchRecentContent"),
  keywordFallbackEnabled: document.querySelector("#keywordFallbackEnabled"),
  endpoint: document.querySelector("#endpoint"),
  model: document.querySelector("#model"),
  apiKey: document.querySelector("#apiKey"),
  threshold: document.querySelector("#threshold"),
  confidenceFloor: document.querySelector("#confidenceFloor"),
  maxSamples: document.querySelector("#maxSamples"),
  sampleCharLimit: document.querySelector("#sampleCharLimit"),
  cacheTtlHours: document.querySelector("#cacheTtlHours"),
  hideMode: document.querySelector("#hideMode"),
  showReason: document.querySelector("#showReason"),
  allowList: document.querySelector("#allowList"),
  blockList: document.querySelector("#blockList")
};

const elements = {
  thresholdValue: document.querySelector("#thresholdValue"),
  confidenceValue: document.querySelector("#confidenceValue"),
  testResult: document.querySelector("#testResult"),
  toast: document.querySelector("#toast")
};

document.querySelector("#saveTop").addEventListener("click", save);
document.querySelector("#saveBottom").addEventListener("click", save);
document.querySelector("#testModel").addEventListener("click", testModel);
document.querySelector("#clearCache").addEventListener("click", clearCache);
document.querySelector("#exportData").addEventListener("click", exportData);
fields.threshold.addEventListener("input", updateRangeLabels);
fields.confidenceFloor.addEventListener("input", updateRangeLabels);

load();

async function load() {
  const response = await send("GET_SETTINGS");
  if (!response.ok) {
    showToast(response.error || "读取设置失败");
    return;
  }
  fill(response.settings);
}

function fill(settings) {
  fields.enabled.checked = Boolean(settings.enabled);
  fields.aiEnabled.checked = Boolean(settings.aiEnabled);
  fields.fetchRecentContent.checked = Boolean(settings.fetchRecentContent);
  fields.keywordFallbackEnabled.checked = Boolean(settings.keywordFallbackEnabled);
  fields.endpoint.value = settings.endpoint || "";
  fields.model.value = settings.model || "";
  fields.apiKey.value = settings.apiKey || "";
  fields.threshold.value = settings.threshold;
  fields.confidenceFloor.value = settings.confidenceFloor;
  fields.maxSamples.value = settings.maxSamples;
  fields.sampleCharLimit.value = settings.sampleCharLimit;
  fields.cacheTtlHours.value = settings.cacheTtlHours;
  fields.hideMode.value = settings.hideMode;
  fields.showReason.checked = Boolean(settings.showReason);
  fields.allowList.value = (settings.allowList || []).join("\n");
  fields.blockList.value = (settings.blockList || []).join("\n");
  updateRangeLabels();
}

async function save() {
  const payload = readForm();
  const response = await send("SAVE_SETTINGS", payload);
  showToast(response.ok ? "设置已保存" : response.error || "保存失败");
}

async function testModel() {
  elements.testResult.textContent = "测试中...";
  const response = await send("TEST_MODEL", { settings: readForm() });
  if (!response.ok) {
    elements.testResult.textContent = response.error || "测试失败";
    return;
  }
  const score = Math.round((response.decision?.score || 0) * 100);
  elements.testResult.textContent = `${response.source} · ${score} · ${response.decision?.reason || ""}`;
}

async function clearCache() {
  const response = await send("CLEAR_CACHE");
  showToast(response.ok ? "缓存已清空" : response.error || "清空失败");
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

function readForm() {
  return {
    enabled: fields.enabled.checked,
    aiEnabled: fields.aiEnabled.checked,
    fetchRecentContent: fields.fetchRecentContent.checked,
    keywordFallbackEnabled: fields.keywordFallbackEnabled.checked,
    endpoint: fields.endpoint.value.trim(),
    model: fields.model.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    threshold: Number(fields.threshold.value),
    confidenceFloor: Number(fields.confidenceFloor.value),
    maxSamples: Number(fields.maxSamples.value),
    sampleCharLimit: Number(fields.sampleCharLimit.value),
    cacheTtlHours: Number(fields.cacheTtlHours.value),
    hideMode: fields.hideMode.value,
    showReason: fields.showReason.checked,
    allowList: parseLines(fields.allowList.value),
    blockList: parseLines(fields.blockList.value)
  };
}

function updateRangeLabels() {
  elements.thresholdValue.textContent = `${Math.round(Number(fields.threshold.value) * 100)}%`;
  elements.confidenceValue.textContent = `${Math.round(Number(fields.confidenceFloor.value) * 100)}%`;
}

function parseLines(value) {
  return Array.from(
    new Set(
      String(value || "")
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function send(type, payload) {
  return chrome.runtime.sendMessage({ type, payload });
}

function showToast(text) {
  elements.toast.textContent = text || "";
  if (text) setTimeout(() => (elements.toast.textContent = ""), 2400);
}
