import { DEFAULT_SETTINGS, EMPTY_STATS, STORAGE_KEYS, mergeSettings } from "./shared/defaults.js";
import {
  SYSTEM_PROMPT,
  buildClassificationPrompt,
  combineDecisions,
  hashText,
  heuristicDecision,
  normalizeDecision,
  parseModelDecision
} from "./shared/classifier.js";
import {
  buildCandidateProfileUrls,
  extractSamplesFromHtml,
  makeAuthorKey,
  normalizeZhihuUrl,
  trimText
} from "./shared/zhihu.js";

const inFlight = new Map();
const MAX_EVENTS = 80;

chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
  const local = await chrome.storage.local.get([STORAGE_KEYS.STATS, STORAGE_KEYS.EVENTS]);
  if (!local[STORAGE_KEYS.STATS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: { ...EMPTY_STATS } });
  }
  if (!local[STORAGE_KEYS.EVENTS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: [] });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch(async (error) => {
      await incrementStats("errors");
      sendResponse({ ok: false, error: error?.message || String(error) });
    });
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "ANALYZE_AUTHOR":
      return analyzeAuthor(message.payload || {}, sender);
    case "GET_STATUS":
      return getStatus();
    case "GET_SETTINGS":
      return { ok: true, settings: await getSettings() };
    case "SAVE_SETTINGS":
      return saveSettings(message.payload || {});
    case "ADD_TO_ALLOWLIST":
      return addToList("allowList", message.payload || {});
    case "ADD_TO_BLOCKLIST":
      return addToList("blockList", message.payload || {});
    case "REMOVE_FROM_LIST":
      return removeFromList(message.payload || {});
    case "CLEAR_CACHE":
      return clearCache();
    case "EXPORT_DATA":
      return exportData();
    case "TEST_MODEL":
      return testModel(message.payload || {});
    default:
      return { ok: false, error: "未知消息类型" };
  }
}

async function analyzeAuthor(payload) {
  const settings = await getSettings();
  if (!settings.enabled) return { ok: true, status: "disabled" };

  const author = normalizeAuthor(payload.author || payload);
  const key = makeAuthorKey(author);
  if (!key) {
    return { ok: true, status: "ignored", reason: "未识别到作者" };
  }

  if (matchesList(settings.allowList, key, author)) {
    return makeResponse("allowed", {
      author,
      key,
      decision: manualDecision(false, "白名单作者"),
      source: "allowlist",
      settings
    });
  }

  if (matchesList(settings.blockList, key, author)) {
    return makeResponse("blocked", {
      author,
      key,
      decision: manualDecision(true, "黑名单作者"),
      source: "blocklist",
      settings
    });
  }

  const cached = await getCachedDecision(key, settings);
  if (cached) {
    return makeResponse(cached.shouldBlock ? "blocked" : "allowed", {
      author,
      key,
      decision: cached,
      source: "cache",
      settings
    });
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const task = runAnalysis({ payload, author, key, settings })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, task);
  return task;
}

async function runAnalysis({ payload, author, key, settings }) {
  await incrementStats("scanned");

  const samples = await collectSamples(payload, author, settings);
  const joinedText = samples.map((sample) => `${sample.title || ""}\n${sample.text || ""}`).join("\n");
  if (joinedText.trim().length < settings.minTextLength) {
    const decision = manualDecision(false, "样本文本过短，暂不处理");
    await cacheDecision(key, author, decision, samples, settings);
    await addEvent({ type: "allowed", author, decision, source: "short-text" });
    await incrementStats("allowed");
    return makeResponse("allowed", { author, key, decision, source: "short-text", settings });
  }

  const heuristic = heuristicDecision({ samples });
  let decision = heuristic;
  let source = "heuristic";

  if (settings.aiEnabled && settings.endpoint && settings.model) {
    try {
      const modelDecision = await classifyWithModel({ author, samples, settings });
      decision = combineDecisions(modelDecision, heuristic, settings.threshold, settings.confidenceFloor);
      source = "model";
    } catch (error) {
      decision = settings.keywordFallbackEnabled ? heuristic : manualDecision(false, "模型不可用，未启用规则兜底");
      source = settings.keywordFallbackEnabled ? "heuristic-fallback" : "model-error";
      await addEvent({ type: "error", author, error: error.message, source });
      await incrementStats("errors");
    }
  }

  const finalDecision = {
    ...decision,
    shouldBlock: decision.shouldBlock && decision.score >= settings.threshold && decision.confidence >= settings.confidenceFloor,
    source,
    samplesHash: hashText(joinedText),
    createdAt: Date.now(),
    expiresAt: Date.now() + settings.cacheTtlHours * 60 * 60 * 1000
  };

  await cacheDecision(key, author, finalDecision, samples, settings);
  await incrementStats(finalDecision.shouldBlock ? "blocked" : "allowed");
  await addEvent({
    type: finalDecision.shouldBlock ? "blocked" : "allowed",
    author,
    decision: finalDecision,
    source
  });

  return makeResponse(finalDecision.shouldBlock ? "blocked" : "allowed", {
    author,
    key,
    decision: finalDecision,
    source,
    settings
  });
}

async function classifyWithModel({ author, samples, settings }) {
  const body = {
    model: settings.model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: buildClassificationPrompt({
          author,
          samples,
          threshold: settings.threshold
        })
      }
    ],
    temperature: 0,
    max_tokens: 240,
    stream: false,
    response_format: { type: "json_object" }
  };

  const response = await postChatCompletion(settings, body, true);
  const content =
    response?.choices?.[0]?.message?.content ||
    response?.choices?.[0]?.text ||
    response?.message?.content ||
    response?.response ||
    "";
  return { ...normalizeDecision(parseModelDecision(content)), source: "model" };
}

async function postChatCompletion(settings, body, allowRetryWithoutJsonMode) {
  const headers = { "Content-Type": "application/json" };
  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  const response = await fetch(settings.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok && allowRetryWithoutJsonMode && "response_format" in body) {
    const retryBody = { ...body };
    delete retryBody.response_format;
    return postChatCompletion(settings, retryBody, false);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`模型接口返回 ${response.status}: ${text.slice(0, 160)}`);
  }

  return response.json();
}

async function collectSamples(payload, author, settings) {
  const samples = [];
  const pageText = trimText(payload.excerpt || payload.text || payload.title || "", settings.sampleCharLimit);
  if (pageText) {
    samples.push({
      title: trimText(payload.title || "", 160),
      text: pageText,
      source: "current-page"
    });
  }

  if (settings.fetchRecentContent && author.url && samples.length < settings.maxSamples) {
    const recent = await fetchRecentSamples(author.url, settings.maxSamples - samples.length, settings.sampleCharLimit);
    for (const sample of recent) {
      if (samples.length >= settings.maxSamples) break;
      const signature = hashText(`${sample.title || ""}\n${sample.text || ""}`);
      if (!samples.some((item) => hashText(`${item.title || ""}\n${item.text || ""}`) === signature)) {
        samples.push(sample);
      }
    }
  }

  return samples.slice(0, settings.maxSamples);
}

async function fetchRecentSamples(authorUrl, limit, charLimit) {
  const output = [];
  for (const url of buildCandidateProfileUrls(authorUrl)) {
    if (output.length >= limit) break;
    try {
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store"
      });
      if (!response.ok) continue;
      const html = await response.text();
      const samples = extractSamplesFromHtml(html, limit - output.length, charLimit);
      output.push(...samples.map((sample) => ({ ...sample, sourceUrl: url })));
    } catch {
      continue;
    }
  }
  return output.slice(0, limit);
}

async function testModel(payload) {
  const settings = mergeSettings({ ...(await getSettings()), ...(payload.settings || {}) });
  const samples = [
    {
      title: "测试样本",
      text:
        payload.sample ||
        "这个问题还用问？懂的都懂，反正不服来辩。只能说有些人急了，典中典。"
    }
  ];
  const author = { name: "测试作者", url: "https://www.zhihu.com/people/test-user" };
  const heuristic = heuristicDecision({ samples });

  if (!settings.aiEnabled || !settings.endpoint || !settings.model) {
    return { ok: true, decision: heuristic, source: "heuristic" };
  }

  const modelDecision = await classifyWithModel({ author, samples, settings });
  return {
    ok: true,
    decision: combineDecisions(modelDecision, heuristic, settings.threshold, settings.confidenceFloor),
    source: "model"
  };
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(STORAGE_KEYS.SETTINGS);
  return mergeSettings(stored[STORAGE_KEYS.SETTINGS] || DEFAULT_SETTINGS);
}

async function saveSettings(payload) {
  const previous = await getSettings();
  const settings = mergeSettings({ ...previous, ...payload });
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
  return { ok: true, settings };
}

async function getStatus() {
  const local = await chrome.storage.local.get([STORAGE_KEYS.STATS, STORAGE_KEYS.EVENTS, STORAGE_KEYS.DECISIONS]);
  return {
    ok: true,
    settings: await getSettings(),
    stats: { ...EMPTY_STATS, ...(local[STORAGE_KEYS.STATS] || {}) },
    events: local[STORAGE_KEYS.EVENTS] || [],
    decisionCount: Object.keys(local[STORAGE_KEYS.DECISIONS] || {}).length
  };
}

async function addToList(listName, payload) {
  const settings = await getSettings();
  const author = normalizeAuthor(payload.author || payload);
  const key = payload.key || makeAuthorKey(author);
  if (!key) return { ok: false, error: "没有可加入名单的作者标识" };

  const next = new Set(settings[listName] || []);
  next.add(key);
  const opposite = listName === "allowList" ? "blockList" : "allowList";
  const oppositeNext = (settings[opposite] || []).filter((item) => item !== key);
  return saveSettings({ [listName]: Array.from(next), [opposite]: oppositeNext });
}

async function removeFromList(payload) {
  const settings = await getSettings();
  const listName = payload.listName;
  const key = payload.key;
  if (!["allowList", "blockList"].includes(listName) || !key) {
    return { ok: false, error: "名单参数不完整" };
  }
  return saveSettings({ [listName]: settings[listName].filter((item) => item !== key) });
}

async function clearCache() {
  await chrome.storage.local.set({
    [STORAGE_KEYS.DECISIONS]: {},
    [STORAGE_KEYS.STATS]: { ...EMPTY_STATS },
    [STORAGE_KEYS.EVENTS]: []
  });
  return { ok: true };
}

async function exportData() {
  const status = await getStatus();
  return {
    ok: true,
    exportedAt: new Date().toISOString(),
    ...status
  };
}

async function getCachedDecision(key, settings) {
  const local = await chrome.storage.local.get(STORAGE_KEYS.DECISIONS);
  const decisions = local[STORAGE_KEYS.DECISIONS] || {};
  const cached = decisions[key];
  if (!cached) return null;
  if (cached.expiresAt && cached.expiresAt < Date.now()) {
    delete decisions[key];
    await chrome.storage.local.set({ [STORAGE_KEYS.DECISIONS]: decisions });
    return null;
  }
  if (cached.createdAt && Date.now() - cached.createdAt > settings.cacheTtlHours * 60 * 60 * 1000) {
    return null;
  }
  return cached;
}

async function cacheDecision(key, author, decision, samples, settings) {
  const local = await chrome.storage.local.get(STORAGE_KEYS.DECISIONS);
  const decisions = local[STORAGE_KEYS.DECISIONS] || {};
  decisions[key] = {
    ...decision,
    author,
    sampleCount: samples.length,
    expiresAt: Date.now() + settings.cacheTtlHours * 60 * 60 * 1000
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.DECISIONS]: trimDecisionCache(decisions) });
}

function trimDecisionCache(decisions) {
  const entries = Object.entries(decisions)
    .sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0))
    .slice(0, 1000);
  return Object.fromEntries(entries);
}

async function incrementStats(field) {
  const local = await chrome.storage.local.get(STORAGE_KEYS.STATS);
  const stats = { ...EMPTY_STATS, ...(local[STORAGE_KEYS.STATS] || {}) };
  stats[field] = (stats[field] || 0) + 1;
  stats.lastScanAt = Date.now();
  await chrome.storage.local.set({ [STORAGE_KEYS.STATS]: stats });
}

async function addEvent(event) {
  const local = await chrome.storage.local.get(STORAGE_KEYS.EVENTS);
  const events = local[STORAGE_KEYS.EVENTS] || [];
  events.unshift({
    ...event,
    at: Date.now()
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.EVENTS]: events.slice(0, MAX_EVENTS) });
}

function makeResponse(status, { author, key, decision, source, settings }) {
  return {
    ok: true,
    status,
    author,
    key,
    decision,
    source,
    hideMode: settings.hideMode,
    showReason: settings.showReason
  };
}

function normalizeAuthor(input) {
  return {
    name: trimText(input.name || input.authorName || "", 80),
    url: normalizeZhihuUrl(input.url || input.authorUrl || "")
  };
}

function matchesList(list, key, author) {
  const normalized = new Set(
    (list || []).map((item) => String(item || "").trim().toLowerCase()).filter(Boolean)
  );
  return (
    normalized.has(String(key || "").toLowerCase()) ||
    normalized.has(String(author.name || "").trim().toLowerCase()) ||
    normalized.has(normalizeZhihuUrl(author.url).toLowerCase())
  );
}

function manualDecision(shouldBlock, reason) {
  return {
    shouldBlock,
    score: shouldBlock ? 1 : 0,
    confidence: 1,
    labels: [reason],
    reason,
    source: "manual"
  };
}
