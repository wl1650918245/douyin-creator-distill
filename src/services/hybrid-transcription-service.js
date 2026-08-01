const crypto = require("crypto");
const fs = require("fs");
const cloudTranscription = require("./getnotes-transcription-service");
const localTranscription = require("./local-whisper-transcription-service");
const { loadTranscriptionConfig } = require("../config/transcription-config");
const {
  appendLog,
  countCloudTranscriptJobsSince,
  createTask,
  createTranscriptJob,
  getTask,
  updateTask,
  updateTranscriptJob,
} = require("./task-store");
const { createTranscriptionBatchOrchestrator } = require("./transcription-batch-orchestrator");
const { executePreferredTranscription, isImageWork } = require("./transcription-routing-policy");
const { filterProcessableWorks } = require("./work-ledger-store");

const PREFERENCES = ["cloud-first", "whisper-first"];

function localDayStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

function cloudQuotaAvailable() {
  const limit = Math.max(1, Number(loadTranscriptionConfig().cloudDailyReferenceLimit || 100));
  return countCloudTranscriptJobsSince(localDayStartIso()) < limit;
}

async function ensureLocalContext(item, context) {
  if (context.localContext) return context.localContext;
  if (context.localPrepareError) throw context.localPrepareError;
  try {
    context.localContext = await localTranscription.prepareBatch(item);
    return context.localContext;
  } catch (error) {
    context.localPrepareError = error;
    throw error;
  }
}

function createController(preference) {
  const label = preference === "cloud-first" ? "云端优先" : "Whisper 优先";
  return createTranscriptionBatchOrchestrator({
    provider: preference,
    runningPhase: `${label}全量批处理中`,
    completedPhase: `${label}全量转写完成`,
    partialPhase: `${label}部分失败，已保留成功结果`,
    prepare({ crawlTaskId }) {
      const context = cloudTranscription.prepareBatch({ crawlTaskId });
      return { ...context, cloudExhausted: false, localContext: null, localPrepareError: null };
    },
    async processJob({ taskId, crawlTaskId, job, context }) {
      const work = context.works.find((entry) => String(entry.videoId) === String(job.video_id)) || {};
      await executePreferredTranscription({
        preference,
        job,
        work,
        cloudAvailable: async () => !context.cloudExhausted && cloudQuotaAvailable(),
        isCloudQuotaError: (error) => {
          const exhausted = cloudTranscription.isQuotaExhaustedError(error);
          if (exhausted) context.cloudExhausted = true;
          return exhausted;
        },
        markProvider: async (provider) => updateTranscriptJob(job.id, { provider }),
        onFallback: async (message) => appendLog(taskId, `作品 ${job.video_id}：${message}`),
        runCloud: async () => cloudTranscription.processPreparedJob({
          taskId,
          job: { ...job, provider: "getnotes" },
          context,
        }),
        runLocal: async () => {
          const localContext = await ensureLocalContext({ taskId, crawlTaskId }, context);
          return localTranscription.processPreparedJob({
            taskId,
            job: { ...job, provider: "whisper" },
            context: localContext,
          });
        },
      });
    },
    async cleanup({ taskId, crawlTaskId, context }) {
      if (context?.localContext) await localTranscription.cleanupBatch({ taskId, crawlTaskId, context: context.localContext });
    },
  });
}

const controllers = Object.fromEntries(PREFERENCES.map((preference) => [preference, createController(preference)]));

function controllerForTask(taskId) {
  const preference = getTask(taskId)?.summary?.provider;
  const controller = controllers[preference];
  if (!controller) throw new Error("该任务不是优先级转写批次");
  return controller;
}

function submit(crawlTaskId, videoIds, preference) {
  if (!PREFERENCES.includes(preference)) throw new Error("不支持的转写优先级");
  const crawlTask = getTask(crawlTaskId);
  if (!crawlTask?.output_path || !fs.existsSync(crawlTask.output_path)) throw new Error("未找到已审核的 JSON，不能创建转写任务。");
  const context = cloudTranscription.prepareBatch({ crawlTaskId });
  const selected = new Set(videoIds.map(String));
  const requestedWorks = context.works.filter((work) => selected.has(String(work.videoId)) && /^https?:\/\//.test(work.videoUrl || ""));
  const plan = filterProcessableWorks(crawlTaskId, requestedWorks);
  const works = plan.works;
  if (!works.length) throw new Error("所选作品均已完成或正在处理中，没有需要重复创建的转写任务。");

  const taskId = crypto.randomUUID();
  const label = preference === "cloud-first" ? "云端优先转写" : "Whisper优先转写";
  createTask(taskId, `${label} / ${crawlTask.source}`, {
    sourceMode: crawlTask.source_mode || "profile",
    accountRole: crawlTask.account_role || "content",
    profileId: crawlTask.profile_id || null,
  });
  updateTask(taskId, {
    status: "queued",
    phase: `等待${label}执行位`,
    creator_name: crawlTask.creator_name || works.find((work) => work.authorNickname)?.authorNickname || "",
    summary_json: JSON.stringify({
      totalCount: works.length,
      requestedCount: requestedWorks.length,
      skippedCompleted: plan.skippedCompleted.length,
      skippedActive: plan.skippedActive.length,
      provider: preference,
      preferredProvider: preference === "cloud-first" ? "getnotes" : "whisper",
    }),
  });
  for (const work of works) {
    const provider = preference === "whisper-first" && !isImageWork(work) ? "whisper" : "getnotes";
    createTranscriptJob({
      id: crypto.randomUUID(),
      taskId,
      crawlTaskId,
      videoId: String(work.videoId),
      videoUrl: work.videoUrl,
      title: work.title || work.desc || `未命名${isImageWork(work) ? "图文" : "视频"} · ${work.videoId}`,
      provider,
    });
  }
  controllers[preference].enqueue(taskId, crawlTaskId);
  return taskId;
}

function pause(taskId) {
  return controllerForTask(taskId).pause(taskId);
}

function resume(taskId) {
  return controllerForTask(taskId).resume(taskId);
}

function retryFailed(taskId) {
  return controllerForTask(taskId).retryFailed(taskId);
}

function recoverPending() {
  return PREFERENCES.reduce((total, preference) => total + controllers[preference].recoverPending(), 0);
}

module.exports = {
  pause,
  recoverPending,
  resume,
  retryFailed,
  submit,
};
