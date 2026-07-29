const {
  appendLog,
  getTask,
  listRecoverableTranscriptTasks,
  listTranscriptJobsForTask,
  resetInterruptedTranscriptJobs,
  retryTranscriptJobs,
  updateTask,
  updateTaskProgress,
  updateTranscriptJob,
} = require("./task-store");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function summarize(jobs, provider) {
  const count = (status) => jobs.filter((job) => job.status === status).length;
  const completed = count("completed");
  const failed = count("failed") + count("partial");
  const running = count("running");
  const queued = count("queued");
  const providerCounts = jobs.reduce((counts, job) => {
    counts[job.provider] = (counts[job.provider] || 0) + 1;
    return counts;
  }, {});
  return {
    totalCount: jobs.length,
    completed,
    failed,
    running,
    queued,
    processed: completed + failed,
    attempts: jobs.reduce((total, job) => total + Number(job.attempt_count || 0), 0),
    provider,
    providerCounts,
  };
}

function shouldAutoRetry(error) {
  const message = String(error?.message || error || "");
  return !/配置文件|apiKey|clientId|运行环境不完整|未登录|登录状态|total request limit|错误码\s*19|配额已用尽/i.test(message);
}

function createTranscriptionBatchOrchestrator(options) {
  const {
    provider,
    runningPhase,
    completedPhase,
    partialPhase,
    prepare,
    processJob,
    cleanup,
  } = options;
  const queue = [];
  const queuedTaskIds = new Set();
  let activeTaskId = "";

  function assertOwnedTask(taskId) {
    const task = getTask(taskId);
    if (!task) throw new Error("转写任务不存在");
    if (task.summary?.provider !== provider) throw new Error("转写任务通道不匹配");
    return task;
  }

  function syncSummary(taskId, fields = {}) {
    const jobs = listTranscriptJobsForTask(taskId);
    const summary = summarize(jobs, provider);
    const { stage, currentVideoId, ...taskFields } = fields;
    updateTaskProgress(taskId, {
      stage: stage || "batch",
      label: fields.phase || runningPhase,
      discovered: summary.processed,
      expectedTotal: summary.totalCount,
      completed: summary.completed,
      failed: summary.failed,
      queued: summary.queued,
      currentVideoId: currentVideoId || "",
    });
    return updateTask(taskId, {
      ...taskFields,
      summary_json: JSON.stringify(summary),
    });
  }

  function enqueue(taskId, crawlTaskId) {
    if (queuedTaskIds.has(taskId) || activeTaskId === taskId) return;
    queue.push({ taskId, crawlTaskId });
    queuedTaskIds.add(taskId);
    pump();
  }

  async function run(item) {
    let context;
    let task = assertOwnedTask(item.taskId);
    if (task.status === "paused") return;
    resetInterruptedTranscriptJobs(item.taskId);
    syncSummary(item.taskId, { status: "running", phase: runningPhase, error_message: null, stage: "running" });
    try {
      context = await prepare?.({ taskId: item.taskId, crawlTaskId: item.crawlTaskId });
      while (true) {
        task = getTask(item.taskId);
        if (["pausing", "paused"].includes(task.status)) {
          syncSummary(item.taskId, {
            status: "paused",
            phase: "批处理已暂停，可从当前断点继续",
            error_message: null,
            stage: "paused",
          });
          appendLog(item.taskId, "批处理已安全暂停；当前已完成作品不会重复处理。");
          return;
        }

        const jobs = listTranscriptJobsForTask(item.taskId);
        const job = jobs.find((entry) => entry.status === "queued");
        if (!job) break;

        const attemptCount = Number(job.attempt_count || 0) + 1;
        updateTranscriptJob(job.id, {
          status: "running",
          attempt_count: attemptCount,
          last_started_at: new Date().toISOString(),
          error_message: null,
        });
        syncSummary(item.taskId, {
          status: "running",
          phase: `${runningPhase}：${job.title}`,
          error_message: null,
          stage: "running",
          currentVideoId: job.video_id,
        });

        try {
          await processJob({ taskId: item.taskId, crawlTaskId: item.crawlTaskId, job: { ...job, attempt_count: attemptCount }, context });
        } catch (error) {
          const maxAttempts = Number(job.max_attempts || 3);
          const retry = attemptCount < maxAttempts && shouldAutoRetry(error);
          updateTranscriptJob(job.id, {
            status: retry ? "queued" : "failed",
            error_message: String(error.message || error),
          });
          appendLog(
            item.taskId,
            retry
              ? `作品 ${job.video_id} 第 ${attemptCount} 次失败，稍后自动重试：${error.message}`
              : `作品 ${job.video_id} 已失败但批次继续：${error.message}`,
          );
          if (retry) await delay(Math.min(15000, attemptCount * 3000));
        }
        if (!["pausing", "paused"].includes(getTask(item.taskId).status)) {
          syncSummary(item.taskId, { status: "running", phase: runningPhase, error_message: null, stage: "running" });
        }
      }
    } catch (error) {
      syncSummary(item.taskId, {
        status: "failed",
        phase: "批处理准备失败",
        error_message: String(error.message || error),
        stage: "failed",
      });
      appendLog(item.taskId, `批处理准备失败：${error.message}`);
      return;
    } finally {
      await cleanup?.({ taskId: item.taskId, crawlTaskId: item.crawlTaskId, context });
    }

    const summary = summarize(listTranscriptJobsForTask(item.taskId), provider);
    syncSummary(item.taskId, {
      status: summary.failed ? "partial" : "waiting_for_user",
      phase: summary.failed ? partialPhase : completedPhase,
      error_message: summary.failed ? `${summary.failed} 条作品失败；其余作品已保留，可仅重试失败项。` : null,
      stage: summary.failed ? "partial" : "completed",
    });
  }

  function pump() {
    if (activeTaskId || !queue.length) return;
    const item = queue.shift();
    queuedTaskIds.delete(item.taskId);
    activeTaskId = item.taskId;
    run(item)
      .catch((error) => updateTask(item.taskId, { status: "failed", phase: "批处理异常退出", error_message: error.message }))
      .finally(() => {
        activeTaskId = "";
        pump();
      });
  }

  function pause(taskId) {
    const task = assertOwnedTask(taskId);
    if (task.status === "paused") return task;
    const status = task.status === "running" && activeTaskId === taskId ? "pausing" : "paused";
    const phase = status === "pausing" ? "正在完成当前作品，随后暂停" : "批处理已暂停，可从当前断点继续";
    appendLog(taskId, status === "pausing" ? "收到暂停请求，当前作品完成后暂停。" : "批处理已暂停。");
    return syncSummary(taskId, { status, phase, error_message: null, stage: status });
  }

  function resume(taskId) {
    const task = assertOwnedTask(taskId);
    const jobs = resetInterruptedTranscriptJobs(taskId);
    if (!jobs.some((job) => job.status === "queued")) throw new Error("当前没有可继续的未完成作品；如有失败项，请使用“重试失败项”。");
    appendLog(taskId, "批处理从 SQLite 断点恢复。");
    syncSummary(taskId, { status: "queued", phase: "等待从断点继续", error_message: null, stage: "queued" });
    enqueue(taskId, jobs[0].crawl_task_id);
    return getTask(taskId);
  }

  function retryFailed(taskId) {
    assertOwnedTask(taskId);
    const count = retryTranscriptJobs(taskId);
    if (!count) throw new Error("当前任务没有失败作品需要重试");
    appendLog(taskId, `已将 ${count} 条失败作品重新加入队列。`);
    syncSummary(taskId, { status: "queued", phase: "失败作品已重新排队", error_message: null, stage: "queued" });
    const job = listTranscriptJobsForTask(taskId)[0];
    enqueue(taskId, job.crawl_task_id);
    return { task: getTask(taskId), retried: count };
  }

  function recoverPending() {
    const tasks = listRecoverableTranscriptTasks(provider);
    tasks.forEach((task) => {
      const job = listTranscriptJobsForTask(task.id)[0];
      if (job) enqueue(task.id, job.crawl_task_id);
    });
    return tasks.length;
  }

  return {
    enqueue,
    pause,
    recoverPending,
    resume,
    retryFailed,
    summarize: (taskId) => summarize(listTranscriptJobsForTask(taskId), provider),
  };
}

module.exports = {
  createTranscriptionBatchOrchestrator,
  shouldAutoRetry,
  summarize,
};
