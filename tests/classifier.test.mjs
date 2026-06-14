import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClassificationPrompt,
  combineDecisions,
  hashText,
  heuristicDecision,
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

test("heuristicDecision 对强引战文本给出更高分", () => {
  const decision = heuristicDecision({
    samples: [
      {
        text: "这还用问？懂的都懂，不服来辩。只能说明有些人急了，典中典，收收味。"
      }
    ]
  });
  assert.ok(decision.score > 0.55);
  assert.ok(decision.labels.length > 0);
});

test("combineDecisions 应用阈值和置信度", () => {
  const decision = combineDecisions(
    { shouldBlock: true, score: 0.86, confidence: 0.8, labels: ["人身攻击"], reason: "攻击性强" },
    { shouldBlock: false, score: 0.2, confidence: 0.4, labels: [], reason: "规则低风险" },
    0.72,
    0.42
  );
  assert.equal(decision.shouldBlock, true);
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
