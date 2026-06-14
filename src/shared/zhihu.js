export function makeAuthorKey(author = {}) {
  const url = normalizeZhihuUrl(author.url || "");
  const slug = extractProfileSlug(url);
  if (slug) return slug;
  const name = String(author.name || "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

export function normalizeZhihuUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value, "https://www.zhihu.com");
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return String(value || "").trim();
  }
}

export function extractProfileSlug(value) {
  const url = normalizeZhihuUrl(value);
  const match = url.match(/zhihu\.com\/(?:people|org)\/([^/?#]+)/i);
  if (!match) return "";
  return decodeURIComponent(match[1]).toLowerCase();
}

export function buildCandidateProfileUrls(authorUrl, limit = 4) {
  const base = normalizeZhihuUrl(authorUrl);
  if (!base) return [];
  const urls = [base, `${base}/answers`, `${base}/posts`, `${base}/pins`];
  return Array.from(new Set(urls)).slice(0, limit);
}

export function extractSamplesFromHtml(html, limit = 3, charLimit = 1100) {
  const samples = [];
  const initialData = extractInitialData(html);
  if (initialData) {
    for (const item of collectContentLikeObjects(initialData)) {
      const title = trimText(item.title || item.question?.title || item.excerpt_title || "", 160);
      const text = trimText(
        [
          item.excerpt,
          item.content,
          item.detail,
          item.description,
          item.question?.excerpt,
          item.question?.detail
        ]
          .filter(Boolean)
          .map(stripHtml)
          .join(" "),
        charLimit
      );
      if (title || text) {
        samples.push({ title, text, source: "initial-data" });
      }
      if (samples.length >= limit) return samples;
    }
  }

  const plain = stripHtml(html);
  const chunks = plain
    .split(/(?:\n|。|！|？|\s{3,})+/)
    .map((item) => trimText(item, charLimit))
    .filter((item) => item.length >= 40 && !isChromeNoise(item));

  for (const chunk of chunks) {
    samples.push({ title: "", text: chunk, source: "html" });
    if (samples.length >= limit) break;
  }
  return samples;
}

export function trimText(value, maxLength = 500) {
  const text = decodeHtmlEntities(String(value || ""))
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function extractInitialData(html) {
  const scriptMatch =
    html.match(/<script[^>]+id=["']js-initialData["'][^>]*>([\s\S]*?)<\/script>/i) ||
    html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (scriptMatch) {
    try {
      return JSON.parse(decodeHtmlEntities(scriptMatch[1].trim()));
    } catch {
      return null;
    }
  }

  const stateMatch = html.match(/window\.__INITIAL_STATE__\s*=\s*({[\s\S]*?});\s*<\/script>/i);
  if (!stateMatch) return null;
  try {
    return JSON.parse(stateMatch[1]);
  } catch {
    return null;
  }
}

function collectContentLikeObjects(root) {
  const output = [];
  const seen = new Set();
  const stack = [root];

  while (stack.length && output.length < 30) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (looksLikeContent(current)) {
      output.push(current);
    }

    for (const value of Object.values(current)) {
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return output;
}

function looksLikeContent(value) {
  if (!value || typeof value !== "object") return false;
  const type = String(value.type || value.__typename || "").toLowerCase();
  const hasBody = Boolean(value.excerpt || value.content || value.detail || value.description);
  const hasTitle = Boolean(value.title || value.question?.title || value.excerpt_title);
  return hasBody && (hasTitle || ["answer", "article", "pin", "post"].some((item) => type.includes(item)));
}

function stripHtml(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function isChromeNoise(text) {
  return /知乎|登录|注册|下载 App|打开 App|切换模式|验证码|var |function |webpack/i.test(text.slice(0, 120));
}
