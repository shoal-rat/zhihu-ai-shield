(() => {
  const CARD_SELECTORS = [
    ".ContentItem",
    ".List-item",
    ".TopstoryItem",
    ".AnswerItem",
    ".Post-Item",
    ".QuestionAnswer-content",
    ".Question-mainColumn .Card",
    "article"
  ];

  const AUTHOR_SELECTORS = [
    "a.UserLink-link[href*='/people/']",
    "a.UserLink-link[href*='/org/']",
    ".AuthorInfo-name a[href*='/people/']",
    ".AuthorInfo-name a[href*='/org/']",
    "a[href^='/people/']",
    "a[href^='/org/']",
    "a[href*='zhihu.com/people/']",
    "a[href*='zhihu.com/org/']"
  ];

  const TITLE_SELECTORS = [
    ".ContentItem-title",
    ".QuestionHeader-title",
    "h1",
    "h2",
    "[itemprop='name']"
  ];

  const BODY_SELECTORS = [
    ".RichContent-inner",
    ".RichText",
    ".ContentItem-excerpt",
    ".ztext",
    "[itemprop='text']"
  ];

  const state = {
    seen: new WeakSet(),
    queued: new WeakSet(),
    active: 0,
    maxActive: 5,
    stopped: false
  };

  const scanSoon = debounce(() => {
    if (state.stopped) return;
    const cards = findCards(document).slice(0, 60);
    for (const card of cards) enqueue(card);
  }, 350);

  init();

  function init() {
    if (!chrome?.runtime?.id) return;
    scanSoon();

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => node.nodeType === Node.ELEMENT_NODE))) {
        scanSoon();
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener("focus", scanSoon, { passive: true });
    setInterval(scanSoon, 4500);
  }

  function findCards(root) {
    const result = new Set();
    if (root?.matches?.(CARD_SELECTORS.join(","))) {
      result.add(root);
    }
    for (const node of root.querySelectorAll?.(CARD_SELECTORS.join(",")) || []) {
      if (isUsefulCard(node)) result.add(node);
    }
    return Array.from(result);
  }

  function isUsefulCard(card) {
    if (!card || state.seen.has(card) || card.dataset.zasState) return false;
    if (card.closest(".zas-shield")) return false;
    if (!card.querySelector(AUTHOR_SELECTORS.join(",")) && !readDataZop(card).authorName) return false;
    return cleanText(card.textContent).length >= 20;
  }

  function enqueue(card) {
    if (state.queued.has(card)) return;
    state.queued.add(card);
    drainQueue();
  }

  async function drainQueue() {
    if (state.active >= state.maxActive) return;
    const cards = Array.from(document.querySelectorAll(CARD_SELECTORS.join(",")))
      .filter((card) => state.queued.has(card) && !state.seen.has(card))
      .slice(0, state.maxActive - state.active);

    for (const card of cards) {
      state.queued.delete(card);
      state.seen.add(card);
      state.active += 1;
      analyzeCard(card)
        .catch(() => {
          card.dataset.zasState = "error";
        })
        .finally(() => {
          state.active -= 1;
          if (state.active < state.maxActive) drainQueue();
        });
    }
  }

  async function analyzeCard(card) {
    const author = extractAuthor(card);
    if (!author.name && !author.url) {
      card.dataset.zasState = "ignored";
      return;
    }

    card.dataset.zasState = "pending";
    const payload = {
      author,
      title: extractTitle(card),
      excerpt: extractBody(card),
      pageUrl: location.href,
      guestVisible: detectGuestLoginPrompt()
    };

    const response = await chrome.runtime.sendMessage({
      type: "ANALYZE_AUTHOR",
      payload
    });

    if (!response?.ok) {
      card.dataset.zasState = "error";
      return;
    }

    card.dataset.zasState = response.status;
    if (response.status === "blocked") {
      blockCard(card, response);
    }
  }

  function extractAuthor(card) {
    const zop = readDataZop(card);
    const anchor = card.querySelector(AUTHOR_SELECTORS.join(","));
    const name = cleanText(anchor?.textContent || zop.authorName || "");
    const href = anchor?.getAttribute("href") || "";
    return {
      name,
      url: href ? new URL(href, location.origin).toString().replace(/\/$/, "") : ""
    };
  }

  function extractTitle(card) {
    for (const selector of TITLE_SELECTORS) {
      const node = card.querySelector(selector);
      const text = cleanText(node?.textContent || "");
      if (text) return text;
    }
    const zop = readDataZop(card);
    return cleanText(zop.title || "");
  }

  function extractBody(card) {
    const parts = [];
    for (const selector of BODY_SELECTORS) {
      for (const node of card.querySelectorAll(selector)) {
        const text = cleanText(node.textContent || "");
        if (text) parts.push(text);
      }
    }
    if (!parts.length) {
      parts.push(cleanText(card.textContent || ""));
    }
    return Array.from(new Set(parts)).join("\n").slice(0, 1600);
  }

  function blockCard(card, response) {
    if (response.hideMode === "hide") {
      card.dataset.zasOriginalDisplay = card.style.display || "";
      card.style.display = "none";
      return;
    }

    card.classList.add("zas-card-blocked", `zas-mode-${response.hideMode || "rewrite"}`);
    card.dataset.zasState = "blocked";
    if (card.querySelector(":scope > .zas-shield")) return;

    const shield = document.createElement("div");
    shield.className = "zas-shield";
    shield.innerHTML = renderShield(response);
    shield.querySelector("[data-zas-action='reveal']")?.addEventListener("click", () => revealCard(card));
    shield.querySelector("[data-zas-action='allow']")?.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "ADD_TO_ALLOWLIST",
        payload: { author: response.author, key: response.key }
      });
      revealCard(card);
    });
    card.prepend(shield);
  }

  function renderShield(response) {
    const authorName = escapeHtml(response.author?.name || "这个作者");
    const decision = response.decision || {};
    const score = Number.isFinite(decision.score) ? Math.round(decision.score * 100) : 0;
    const labels = Array.isArray(decision.labels) ? decision.labels.slice(0, 3) : [];
    const reason = response.showReason ? escapeHtml(decision.reason || "低质量内容风险较高") : "已按本机 LLM 屏蔽";
    const tagHtml = labels.map((label) => `<span class="zas-tag">${escapeHtml(label)}</span>`).join("");

    return `
      <div class="zas-shield-main">
        <div class="zas-mark">AI</div>
        <div class="zas-copy">
          <div class="zas-title">已挡下 ${authorName}</div>
          <div class="zas-meta">${reason} · 评分 ${score}</div>
          <div class="zas-tags">${tagHtml}</div>
        </div>
      </div>
      <div class="zas-actions">
        <button type="button" data-zas-action="reveal">临时展开</button>
        <button type="button" data-zas-action="allow">加入白名单</button>
      </div>
    `;
  }

  function revealCard(card) {
    card.classList.remove("zas-card-blocked", "zas-mode-rewrite", "zas-mode-collapse", "zas-mode-blur");
    card.dataset.zasState = "revealed";
    card.style.display = card.dataset.zasOriginalDisplay || "";
    card.querySelector(":scope > .zas-shield")?.remove();
  }

  function readDataZop(card) {
    const raw = card?.getAttribute?.("data-zop");
    if (!raw) return {};
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  function detectGuestLoginPrompt() {
    const text = cleanText(document.body?.textContent || "").slice(0, 20000);
    return /登录后|登录知乎|注册知乎|打开知乎 App|下载知乎 App/.test(text);
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\u200b/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function debounce(fn, wait) {
    let timer = 0;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  }
})();
