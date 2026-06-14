import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClassificationPrompt,
  hashText,
  parseModelDecision
} from "../src/shared/classifier.js";

test("parseModelDecision 解析纯 JSON", () => {
  const decision = parseModelDecision('{"shouldBlock":true,"score":0.91,"confidence":0.8,"labels":["引战"],"reason":"引战语气"}');
  assert.equal(decision.shouldBlock, true);
  assert.equal(decision.score, 0.91);
  assert.deepEqual(decision.labels, ["引战"]);
});

test("parseModelDecision 解析 fenced JSON", () => {
  const decision = parseModelDecision('```json\n{"shouldBlock":false,"score":0.2,"confidence":0.9,"labels":[],"reason":"正常讨论"}\n```');
  assert.equal(decision.shouldBlock, false);
  assert.equal(decision.reason, "正常讨论");
});

test("buildClassificationPrompt 包含作者和样本", () => {
  const prompt = buildClassificationPrompt({
    author: { name: "测试作者", url: "https://www.zhihu.com/people/test" },
    threshold: 0.72,
    samples: [{ title: "标题", text: "正文内容" }]
  });
  assert.match(prompt, /测试作者/);
  assert.match(prompt, /正文内容/);
});

test("hashText 稳定", () => {
  assert.equal(hashText("abc"), hashText("abc"));
  assert.notEqual(hashText("abc"), hashText("abcd"));
});
