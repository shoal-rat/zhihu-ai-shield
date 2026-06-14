export const SYSTEM_PROMPT = `你是一个运行在用户浏览器里的个人内容过滤分类器。
任务：只根据文本行为判断作者近期内容是否可能让用户感到低质量、引战、阴阳怪气、人身攻击、钓鱼、谣言口吻或无效争吵。
边界：不要因为作者的性别、年龄、地域、民族、国籍、职业、疾病、宗教、政治身份等身份属性给分；不要输出辱骂；不要扩大化。
请返回严格 JSON，不要解释，不要 Markdown，不要输出思考过程，不要输出 <think> 标签。shouldBlock 必须和 score、confidence 的风险判断一致。结构：
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
如果 score 低于屏蔽阈值，请把 shouldBlock 设为 false；如果文本明显引战、人身攻击、钓鱼或低信息密度，score 应显著高于阈值。

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

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
