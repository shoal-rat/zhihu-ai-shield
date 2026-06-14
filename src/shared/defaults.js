export const STORAGE_KEYS = Object.freeze({
  SETTINGS: "zas_settings",
  DECISIONS: "zas_decisions",
  STATS: "zas_stats",
  EVENTS: "zas_events"
});

export const DEFAULT_SETTINGS = Object.freeze({
  enabled: true,
  endpoint: "http://127.0.0.1:11434/v1/chat/completions",
  model: "qwen2.5:0.5b",
  threshold: 0.72,
  confidenceFloor: 0.42,
  hideMode: "rewrite",
  maxSamples: 3,
  sampleCharLimit: 1100,
  minTextLength: 24,
  cacheTtlHours: 168,
  fetchRecentContent: true,
  showReason: true,
  guestMode: true,
  allowList: [],
  blockList: []
});

export const EMPTY_STATS = Object.freeze({
  scanned: 0,
  blocked: 0,
  allowed: 0,
  errors: 0,
  lastScanAt: null
});

export const HIDE_MODES = Object.freeze(["rewrite", "collapse", "hide", "blur"]);

export function mergeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...(input || {}) };
  merged.threshold = clampNumber(merged.threshold, 0.05, 0.98, DEFAULT_SETTINGS.threshold);
  merged.confidenceFloor = clampNumber(
    merged.confidenceFloor,
    0,
    0.95,
    DEFAULT_SETTINGS.confidenceFloor
  );
  merged.maxSamples = Math.round(clampNumber(merged.maxSamples, 1, 5, DEFAULT_SETTINGS.maxSamples));
  merged.sampleCharLimit = Math.round(
    clampNumber(merged.sampleCharLimit, 260, 3000, DEFAULT_SETTINGS.sampleCharLimit)
  );
  merged.minTextLength = Math.round(
    clampNumber(merged.minTextLength, 0, 240, DEFAULT_SETTINGS.minTextLength)
  );
  merged.cacheTtlHours = Math.round(clampNumber(merged.cacheTtlHours, 1, 24 * 30, DEFAULT_SETTINGS.cacheTtlHours));
  merged.hideMode = HIDE_MODES.includes(merged.hideMode) ? merged.hideMode : DEFAULT_SETTINGS.hideMode;
  merged.allowList = normalizeList(merged.allowList);
  merged.blockList = normalizeList(merged.blockList);
  merged.endpoint = String(merged.endpoint || "").trim();
  merged.model = String(merged.model || "").trim();
  return merged;
}

function clampNumber(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function normalizeList(list) {
  if (!Array.isArray(list)) return [];
  return Array.from(
    new Set(
      list
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
}
