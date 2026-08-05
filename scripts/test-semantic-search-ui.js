const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");

for (const id of ["semantic-query", "semantic-search-button", "semantic-rerank-button", "semantic-index-button", "semantic-clear-button", "semantic-index-status"]) {
  assert(html.includes(`id="${id}"`), `缺少智能搜索控件 ${id}`);
}
for (const endpoint of ["/api/semantic-index", "/api/semantic-indexes", "/api/semantic-search"]) {
  assert(server.includes(endpoint), `缺少智能搜索接口 ${endpoint}`);
}
assert(app.includes("runSemanticSearch(false)"), "智能搜索按钮未连接本地召回");
assert(app.includes("runSemanticSearch(true)"), "精排复核按钮未连接显式精排");
assert(app.includes("semanticResultIds.has(work.id)"), "搜索结果未接入作品目录筛选");

console.log("[通过] 内容工作台智能搜索、显式精排和索引状态交互已接通");
