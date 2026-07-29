const assert = require("assert/strict");
const { executePreferredTranscription } = require("../src/services/transcription-routing-policy");

function scenario(overrides = {}) {
  const calls = [];
  return {
    calls,
    options: {
      preference: "cloud-first",
      job: { provider: "getnotes" },
      work: { contentType: "video" },
      cloudAvailable: async () => true,
      isCloudQuotaError: (error) => error.code === 19,
      markProvider: async (provider) => calls.push(`provider:${provider}`),
      onFallback: async () => calls.push("fallback"),
      runCloud: async () => { calls.push("cloud"); return "cloud"; },
      runLocal: async () => { calls.push("local"); return "local"; },
      ...overrides,
    },
  };
}

async function run() {
  const cloudFirst = scenario();
  assert.equal(await executePreferredTranscription(cloudFirst.options), "cloud");
  assert.deepEqual(cloudFirst.calls, ["provider:getnotes", "cloud"]);

  const localAfterReferenceLimit = scenario({ cloudAvailable: async () => false });
  assert.equal(await executePreferredTranscription(localAfterReferenceLimit.options), "local");
  assert.deepEqual(localAfterReferenceLimit.calls, ["fallback", "provider:whisper", "local"]);

  const localAfterProviderQuota = scenario({
    runCloud: async () => {
      const error = new Error("total request limit");
      error.code = 19;
      throw error;
    },
  });
  assert.equal(await executePreferredTranscription(localAfterProviderQuota.options), "local");
  assert.deepEqual(localAfterProviderQuota.calls, ["provider:getnotes", "fallback", "provider:whisper", "local"]);

  const networkFailure = scenario({ runCloud: async () => { throw new Error("ETIMEDOUT"); } });
  await assert.rejects(() => executePreferredTranscription(networkFailure.options), /ETIMEDOUT/);
  assert.deepEqual(networkFailure.calls, ["provider:getnotes"]);

  const whisperFallback = scenario({
    preference: "whisper-first",
    job: { provider: "whisper" },
    runLocal: async () => { throw new Error("下载失败"); },
  });
  assert.equal(await executePreferredTranscription(whisperFallback.options), "cloud");
  assert.deepEqual(whisperFallback.calls, ["provider:whisper", "fallback", "provider:getnotes", "cloud"]);

  const imageUsesCloud = scenario({
    preference: "whisper-first",
    job: { provider: "getnotes" },
    work: { contentType: "image", hasImages: true },
  });
  assert.equal(await executePreferredTranscription(imageUsesCloud.options), "cloud");
  assert.deepEqual(imageUsesCloud.calls, ["provider:getnotes", "cloud"]);

  console.log("transcription routing policy tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
