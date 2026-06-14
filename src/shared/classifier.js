const POSITIVE_RULES = [
  {
    label: "人身攻击",
    weight: 0.28,
    patterns: ["傻逼", "脑残", "弱智", "贱", "滚", "废物", "你也配", "智商", "畜"]
  },
  {
    label: "阴阳怪气",
    weight: 0.16,
    patterns: ["急了", "典中典", "乐", "绷不住", "不会吧", "赢麻了", "孝", "太懂了"]
  },
  {
    label: "引战钓鱼",
    weight: 0.22,
    patterns: ["不服来辩", "懂的都懂", "屁股决定脑袋", "收收味", "破防", "洗地", "带节奏"]
  },
  {
    label: "低信息密度",
    weight: 0.14,
    patterns: ["众所周知", "只能说明", "有没有一种可能", "这还用问", "我只能说", "省流"]
  },
  {
    label: "谣言口吻",
    weight: 0.18,
    patterns: ["内部消息", "懂得自然懂", "不方便多说", "绝对是真的", "细思极恐"]
  }
];

const NEGATIVE_RULES = [
  {
    label: "解释充分",
    weight: -0.18,
    patterns: ["数据", "来源", "引用", "实验", "样本", "复现", "论证", "原文", "链接"]
  },
  {
    label: "语气克制",
    weight: -0.12,
    patterns: ["可能", "我理解", "不一定", "取决于", "补充一下", "我的判断", "欢迎指正"]
  }
];

export const SYSTEM_PROMPT = `你是一个运行在用户浏览器里的个人内容过滤分类器。
任务：只根据文本行为判断作者近期内容是否可能让用户感到低质量、引战、阴阳怪气、人身攻击、钓鱼、谣言口吻或无效争吵。
边界：不要因为作者的性别、年龄、地域、民族、国籍、职业、疾病、宗教、政治身份等身份属性给分；不要输出辱骂；不要扩大化。
请返回严格 JSON，不要解释，不要 Markdown。结构：
{"shouldBlock": boolean, "score": number, "confidence": number, "labels": string[], "reason": string}
score 表示建议屏蔽强度，0 到 1；confidence 表示判断把握，0 到 1；reason 用不超过 32 个中文字符说明具体文本行为。`;

export function buildClassificationPrompt({ author, samples, threshold }) {
  const normalizedSamples = samples
    .map((sample, index) => {
      const body = trimForPrompt(sample.text || sample, 1200);
      const title = sample.title ? `标题：${trimForPrompt(sample.title, 120)}\n` : "";
      return `样本 ${index + 1}\n${title}正文：${body}`;
    })
    .join("\n\n---\n\n");

  return `用户希望在知乎阅读时自动挡掉低质量争吵型作者。
屏蔽阈值：${threshold}
作者：${author?.name || "未知作者"}
作者链接：${author?.url || "未知链接"}

请判断这个作者是否应该被本地屏蔽。优先看近作的文本行为和信息密度，不要用身份属性判断。

${normalizedSamples}`;
}

export function parseModelDecision(rawText) {
  if (!rawText) {
    throw new Error("模型没有返回内容");
  }

  const text = String(rawText).trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : extractJsonObject(text);
  const parsed = JSON.parse(candidate);
  return normalizeDecision(parsed);
}

export function normalizeDecision(input, fallback = {}) {
  const score = clamp01(Number(input?.score ?? fallback.score ?? 0));
  const confidence = clamp01(Number(input?.confidence ?? fallback.confidence ?? 0.5));
  const shouldBlock = Boolean(input?.shouldBlock ?? score >= 0.72);
  const labels = Array.isArray(input?.labels)
    ? input.labels.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
    : fallback.labels || [];
  const reason = String(input?.reason || fallback.reason || "未给出明确原因")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);

  return { shouldBlock, score, confidence, labels, reason };
}

export function heuristicDecision({ samples }) {
  const text = samples
    .map((sample) => `${sample.title || ""}\n${sample.text || sample || ""}`)
    .join("\n")
    .slice(0, 6000);
  const compact = text.replace(/\s+/g, "");
  let score = 0.12;
  const labels = [];

  for (const rule of POSITIVE_RULES) {
    const hits = countHits(compact, rule.patterns);
    if (hits > 0) {
      score += Math.min(rule.weight, rule.weight * hits * 0.55);
      labels.push(rule.label);
    }
  }

  for (const rule of NEGATIVE_RULES) {
    const hits = countHits(compact, rule.patterns);
    if (hits > 0) {
      score += Math.max(rule.weight, rule.weight * hits * 0.45);
    }
  }

  const punctuationRatio = text.length ? (text.match(/[！？!?]{2,}|[。！？!?]\s*[。！？!?]/g) || []).length / Math.max(1, text.length / 120) : 0;
  if (punctuationRatio > 0.18) {
    score += 0.08;
    labels.push("情绪化表达");
  }

  const reason = labels.length ? `${labels.slice(0, 2).join("、")}较明显` : "规则未发现强烈异常";
  const normalizedScore = clamp01(score);
  return {
    shouldBlock: normalizedScore >= 0.82,
    score: normalizedScore,
    confidence: labels.length ? 0.58 : 0.38,
    labels: Array.from(new Set(labels)).slice(0, 5),
    reason,
    source: "heuristic"
  };
}

export function combineDecisions(modelDecision, heuristic, threshold, confidenceFloor) {
  const model = normalizeDecision(modelDecision, heuristic);
  const rule = normalizeDecision(heuristic);
  const blendedScore = clamp01(model.score * 0.82 + rule.score * 0.18);
  const score = Math.max(blendedScore, rule.score >= 0.9 ? rule.score : 0);
  const confidence = Math.max(model.confidence, rule.score >= 0.9 ? rule.confidence : 0);
  const shouldBlock = (model.shouldBlock || score >= threshold) && confidence >= confidenceFloor;

  return {
    shouldBlock,
    score,
    confidence,
    labels: Array.from(new Set([...(model.labels || []), ...(rule.labels || [])])).slice(0, 6),
    reason: model.reason || rule.reason,
    source: model.source || "model"
  };
}

export function hashText(text) {
  let hash = 2166136261;
  const value = String(text || "");
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function trimForPrompt(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型返回不是 JSON");
  }
  return text.slice(start, end + 1);
}

function countHits(text, patterns) {
  return patterns.reduce((total, pattern) => {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = text.match(new RegExp(escaped, "gi"));
    return total + (matches ? matches.length : 0);
  }, 0);
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
