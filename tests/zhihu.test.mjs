import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidateProfileUrls,
  extractProfileSlug,
  extractSamplesFromHtml,
  makeAuthorKey,
  normalizeZhihuUrl,
  trimText
} from "../src/shared/zhihu.js";

test("normalizeZhihuUrl 规范相对链接", () => {
  assert.equal(
    normalizeZhihuUrl("/people/someone?utm=1#hash"),
    "https://www.zhihu.com/people/someone"
  );
});

test("extractProfileSlug 提取 people slug", () => {
  assert.equal(extractProfileSlug("https://www.zhihu.com/people/SomeOne"), "someone");
});

test("makeAuthorKey 优先使用 slug", () => {
  assert.equal(makeAuthorKey({ name: "张三", url: "https://www.zhihu.com/people/abc" }), "abc");
});

test("buildCandidateProfileUrls 生成近作页面", () => {
  const urls = buildCandidateProfileUrls("https://www.zhihu.com/people/abc");
  assert.deepEqual(urls.slice(0, 3), [
    "https://www.zhihu.com/people/abc",
    "https://www.zhihu.com/people/abc/answers",
    "https://www.zhihu.com/people/abc/posts"
  ]);
});

test("extractSamplesFromHtml 从 js-initialData 中提取内容", () => {
  const data = {
    initialState: {
      entities: {
        answers: {
          "1": {
            type: "answer",
            excerpt: "这是一个包含充分论证和数据来源的回答。",
            question: { title: "问题标题" }
          }
        }
      }
    }
  };
  const html = `<html><script id="js-initialData" type="text/json">${JSON.stringify(data)}</script></html>`;
  const samples = extractSamplesFromHtml(html, 3, 200);
  assert.equal(samples.length, 1);
  assert.equal(samples[0].title, "问题标题");
  assert.match(samples[0].text, /充分论证/);
});

test("trimText 清理空白并截断", () => {
  assert.equal(trimText("  a   b  ", 20), "a b");
  assert.equal(trimText("abcdef", 3), "abc...");
});
