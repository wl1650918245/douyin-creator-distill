const { classifyTranscriptionError, transcriptionError } = require("./transcription-error-policy");

function isImageWork(work) {
  return Boolean(work?.hasImages || work?.contentType === "image");
}

async function executePreferredTranscription(options) {
  const {
    preference,
    job,
    work,
    cloudAvailable,
    isCloudQuotaError,
    markProvider,
    onFallback,
    runCloud,
    runLocal,
  } = options;

  const useCloud = async () => {
    await markProvider("getnotes");
    return runCloud();
  };
  const useLocal = async () => {
    if (isImageWork(work)) {
      throw transcriptionError("图文作品没有音轨，无法使用本地 Whisper，需要 OCR 图文提取通道", "image_ocr_required", false);
    }
    await markProvider("whisper");
    return runLocal();
  };
  const useImageCloud = async () => {
    if (!(await cloudAvailable())) {
      throw transcriptionError("图文作品的云端通道当前不可用，且本地 Whisper 不支持图文，需要 OCR 图文提取通道", "image_ocr_required", false);
    }
    try {
      return await useCloud();
    } catch (error) {
      const classified = classifyTranscriptionError(error);
      if (classified.retryable) throw error;
      throw transcriptionError("图文作品云端提取失败，当前没有可用 OCR 图文提取通道", "image_ocr_required", false, error);
    }
  };

  if (isImageWork(work)) return useImageCloud();

  if (preference === "cloud-first") {
    if (job.provider === "whisper") return useLocal();
    if (!(await cloudAvailable())) {
      await onFallback("云端今日参考额度已用尽，自动切换本地 Whisper");
      return useLocal();
    }
    try {
      return await useCloud();
    } catch (error) {
      if (!isCloudQuotaError(error)) throw error;
      await onFallback("云端返回额度耗尽，当前及后续视频自动切换本地 Whisper");
      return useLocal();
    }
  }

  if (preference === "whisper-first") {
    if (job.provider === "getnotes") return useCloud();
    try {
      return await useLocal();
    } catch (error) {
      await onFallback(`本地转写失败，自动切换云端：${error.message}`);
      return useCloud();
    }
  }

  throw new Error("不支持的转写优先级");
}

module.exports = {
  executePreferredTranscription,
  isImageWork,
};
