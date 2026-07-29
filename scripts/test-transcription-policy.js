const assert = require("assert/strict");
const { validateTranscriptionRequest } = require("../src/services/transcription-request-policy");

const videoIds = Array.from({ length: 594 }, (_, index) => String(index + 1));

assert.equal(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds, provider: "whisper" }), "");
assert.equal(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds, provider: "cloud-first" }), "");
assert.equal(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds, provider: "whisper-first" }), "");
assert.match(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds, provider: "getnotes" }), /最多提交 100 条/);
assert.match(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds: [], provider: "whisper" }), /至少选择 1 条/);
assert.match(validateTranscriptionRequest({ crawlTaskId: "demo", videoIds: ["1"], provider: "unknown" }), /不支持/);

console.log("transcription request policy tests passed");
