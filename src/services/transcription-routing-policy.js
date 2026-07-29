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
    if (isImageWork(work)) throw new Error("图文作品无法使用本地 Whisper，且云端额度当前不可用");
    await markProvider("whisper");
    return runLocal();
  };

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
    if (job.provider === "getnotes" || isImageWork(work)) return useCloud();
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
