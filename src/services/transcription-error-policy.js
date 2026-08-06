const MAX_TOTAL_ATTEMPTS = 6;

function transcriptionError(message, errorClass, retryable = false, cause = null) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.errorClass = errorClass;
  error.retryable = retryable;
  error.terminalReason = retryable ? null : message;
  return error;
}

function classifyTranscriptionError(error) {
  const message = String(error?.message || error || "未知转写错误");
  if (error?.errorClass) {
    return {
      code: error.errorClass,
      retryable: error.retryable === true,
      terminalReason: error.retryable === true ? null : (error.terminalReason || message),
    };
  }

  if (/图文作品无法使用本地 Whisper|需要 OCR|不支持.*图文|unsupported media/i.test(message)) {
    return { code: "unsupported_media", retryable: false, terminalReason: message };
  }
  if (/任务失败：|provider task failed/i.test(message)) {
    return { code: "provider_task_failed", retryable: false, terminalReason: message };
  }
  if (/配置文件|apiKey|clientId|运行环境不完整|缺少.*配置/i.test(message)) {
    return { code: "configuration_error", retryable: false, terminalReason: message };
  }
  if (/未登录|登录状态|unauthorized|forbidden|401|403/i.test(message)) {
    return { code: "authentication_error", retryable: false, terminalReason: message };
  }
  if (/total request limit|错误码\s*19|额度已用尽|配额已用尽/i.test(message)) {
    return { code: "quota_exhausted", retryable: false, terminalReason: message };
  }
  if (/qps|错误码\s*18|rate.?limit|429/i.test(message)) {
    return { code: "rate_limited", retryable: true, terminalReason: null };
  }
  if (/ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|socket hang up|network|timeout|超时/i.test(message)) {
    return { code: "network_transient", retryable: true, terminalReason: null };
  }
  return { code: "unknown_terminal", retryable: false, terminalReason: message };
}

function canRetryTranscriptJob(job) {
  return ["failed", "partial"].includes(job?.status)
    && Number(job?.retryable) === 1
    && Number(job?.attempt_count || 0) < MAX_TOTAL_ATTEMPTS;
}

module.exports = {
  MAX_TOTAL_ATTEMPTS,
  canRetryTranscriptJob,
  classifyTranscriptionError,
  transcriptionError,
};
