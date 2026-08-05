const crypto = require("crypto");

function normalizeText(value) {
  return String(value || "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function contentHash(value) {
  return crypto.createHash("sha256").update(normalizeText(value), "utf8").digest("hex");
}

function chunkText(value, size = 1200, overlap = 120) {
  const text = normalizeText(value);
  if (!text) return [];
  const chunks = [];
  const step = Math.max(1, size - overlap);
  for (let start = 0; start < text.length; start += step) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
  }
  return chunks;
}

module.exports = { chunkText, contentHash, normalizeText };
