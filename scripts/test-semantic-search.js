const assert = require("assert");
const { chunkText, contentHash, normalizeText } = require("../src/services/semantic-text");

assert.strictEqual(normalizeText("  标题   测试\r\n\r\n\r\n正文  "), "标题 测试\n\n正文");
assert.strictEqual(contentHash("作品 A"), contentHash("  作品   A  "));
assert.notStrictEqual(contentHash("作品 A"), contentHash("作品 B"));

const chunks = chunkText("一".repeat(2600), 1200, 120);
assert.strictEqual(chunks.length, 3);
assert.strictEqual(chunks[0].length, 1200);
assert.strictEqual(chunks[1].slice(0, 120), chunks[0].slice(-120));

console.log("[通过] 智能搜索文本规范化、内容哈希和分段契约正确");
