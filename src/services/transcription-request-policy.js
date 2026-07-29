const CLOUD_MAX_WORKS_PER_TASK = 100;
const PRIORITY_PROVIDERS = ["cloud-first", "whisper-first"];
const LEGACY_PROVIDERS = ["getnotes", "whisper"];

function validateTranscriptionRequest({ crawlTaskId, videoIds, provider }) {
  if (typeof crawlTaskId !== "string" || !Array.isArray(videoIds) || !videoIds.length) {
    return "请至少选择 1 条真实作品后再转写";
  }
  if (![...PRIORITY_PROVIDERS, ...LEGACY_PROVIDERS].includes(provider)) return "不支持的转写通道";
  if (provider === "getnotes" && videoIds.length > CLOUD_MAX_WORKS_PER_TASK) {
    return `云端链接提取每次最多提交 ${CLOUD_MAX_WORKS_PER_TASK} 条；本地 Whisper 不限制总数`;
  }
  return "";
}

module.exports = { CLOUD_MAX_WORKS_PER_TASK, LEGACY_PROVIDERS, PRIORITY_PROVIDERS, validateTranscriptionRequest };
