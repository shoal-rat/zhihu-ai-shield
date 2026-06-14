import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

assert(manifest.manifest_version === 3, "manifest_version 必须是 3");
assert(manifest.name, "缺少扩展名称");
assert(manifest.background?.service_worker, "缺少 background service worker");
assert(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0, "缺少 content_scripts");

const files = [
  manifest.background.service_worker,
  manifest.action?.default_popup,
  manifest.options_page,
  ...Object.values(manifest.icons || {})
].filter(Boolean);

for (const script of manifest.content_scripts || []) {
  files.push(...(script.js || []), ...(script.css || []));
}

for (const file of new Set(files)) {
  await access(join(root, file));
}

const requiredHosts = ["https://www.zhihu.com/*", "http://127.0.0.1:*/*", "http://localhost:*/*"];
for (const host of requiredHosts) {
  assert(manifest.host_permissions.includes(host), `缺少 host permission: ${host}`);
}

console.log("manifest 校验通过");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
