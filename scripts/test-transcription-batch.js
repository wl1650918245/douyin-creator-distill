const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-distill-batch-"));
process.env.KNOWLEDGE_ASSET_ROOT = tempRoot;

const store = require("../src/services/task-store");
const { createTranscriptionBatchOrchestrator } = require("../src/services/transcription-batch-orchestrator");

function waitFor(predicate, label, timeoutMs = 6000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      const value = predicate();
      if (value) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(new Error(`等待批处理状态超时：${label}`));
      setTimeout(poll, 20);
    };
    poll();
  });
}

function createBatch(label, count) {
  const crawlTaskId = `${label}-crawl`;
  const taskId = `${label}-batch`;
  store.createTask(crawlTaskId, label);
  store.createTask(taskId, `Whisper转写 / ${label}`);
  store.updateTask(taskId, {
    status: "queued",
    phase: "等待执行",
    summary_json: JSON.stringify({ totalCount: count, provider: "whisper" }),
  });
  for (let index = 1; index <= count; index++) {
    store.createTranscriptJob({
      id: `${label}-job-${index}`,
      taskId,
      crawlTaskId,
      videoId: String(index),
      videoUrl: `https://example.com/${index}`,
      title: `${label}-${index}`,
      provider: "whisper",
    });
  }
  return { crawlTaskId, taskId };
}

async function testFailureIsolationAndRetry() {
  const batch = createBatch("failure", 3);
  store.updateTranscriptJob("failure-job-2", { max_attempts: 1 });
  let failSecond = true;
  const processed = [];
  const orchestrator = createTranscriptionBatchOrchestrator({
    provider: "whisper",
    runningPhase: "测试批处理中",
    completedPhase: "测试完成",
    partialPhase: "测试部分失败",
    async processJob({ job }) {
      processed.push(job.video_id);
      if (job.video_id === "2" && failSecond) throw new Error("模拟单项失败");
      store.updateTranscriptJob(job.id, { status: "completed", error_message: null });
    },
  });

  orchestrator.enqueue(batch.taskId, batch.crawlTaskId);
  await waitFor(() => store.getTask(batch.taskId).status === "partial", "单项失败后批次部分完成").catch((error) => {
    console.error(store.getTask(batch.taskId));
    console.error(store.listTranscriptJobsForTask(batch.taskId));
    throw error;
  });
  assert.deepEqual(processed, ["1", "2", "3"]);
  assert.equal(store.getTranscriptJob("failure-job-1").status, "completed");
  assert.equal(store.getTranscriptJob("failure-job-2").status, "failed");
  assert.equal(store.getTranscriptJob("failure-job-3").status, "completed");

  failSecond = false;
  const retry = orchestrator.retryFailed(batch.taskId);
  assert.equal(retry.retried, 1);
  await waitFor(() => store.getTask(batch.taskId).status === "waiting_for_user", "失败项重试完成");
  assert.equal(store.getTranscriptJob("failure-job-2").status, "completed");
  assert.deepEqual(processed, ["1", "2", "3", "2"]);
}

async function testPauseAndResume() {
  const batch = createBatch("pause", 4);
  const orchestrator = createTranscriptionBatchOrchestrator({
    provider: "whisper",
    runningPhase: "测试批处理中",
    completedPhase: "测试完成",
    partialPhase: "测试部分失败",
    async processJob({ job }) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      store.updateTranscriptJob(job.id, { status: "completed", error_message: null });
    },
  });

  orchestrator.enqueue(batch.taskId, batch.crawlTaskId);
  await waitFor(() => store.listTranscriptJobsForTask(batch.taskId).some((job) => job.status === "running"), "首条作品进入执行中");
  const liveProgress = store.getTask(batch.taskId).progress;
  assert.equal(liveProgress.currentVideoId, "1");
  assert.equal(liveProgress.currentTitle, "pause-1");
  assert.equal(liveProgress.currentProvider, "whisper");
  orchestrator.pause(batch.taskId);
  await waitFor(() => store.getTask(batch.taskId).status === "paused", "安全暂停生效");
  const paused = orchestrator.summarize(batch.taskId);
  assert.equal(paused.completed, 1);
  assert.equal(paused.queued, 3);

  orchestrator.resume(batch.taskId);
  await waitFor(() => store.getTask(batch.taskId).status === "waiting_for_user", "断点继续完成");
  const completed = orchestrator.summarize(batch.taskId);
  assert.equal(completed.completed, 4);
  assert.equal(completed.failed, 0);
}

function testRestartRecovery() {
  const restartRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-distill-restart-"));
  const storePath = path.join(projectRoot, "src", "services", "task-store.js");
  const createScript = `
    process.env.KNOWLEDGE_ASSET_ROOT=${JSON.stringify(restartRoot)};
    const store=require(${JSON.stringify(storePath)});
    store.createTask("crawl","demo");
    store.createTask("batch","Whisper转写 / demo");
    store.updateTask("batch",{status:"running",phase:"处理中",summary_json:JSON.stringify({provider:"whisper",totalCount:1})});
    store.createTranscriptJob({id:"job",taskId:"batch",crawlTaskId:"crawl",videoId:"1",videoUrl:"https://example.com/1",title:"demo",provider:"whisper"});
    store.updateTranscriptJob("job",{status:"running"});
    store.closeTaskStore();
  `;
  const verifyScript = `
    process.env.KNOWLEDGE_ASSET_ROOT=${JSON.stringify(restartRoot)};
    const assert=require("assert/strict");
    const store=require(${JSON.stringify(storePath)});
    assert.equal(store.getTask("batch").status,"queued");
    assert.equal(store.getTranscriptJob("job").status,"queued");
    store.closeTaskStore();
  `;
  for (const script of [createScript, verifyScript]) {
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }
  fs.rmSync(restartRoot, { recursive: true, force: true });
}

function testCloudQuotaCounter() {
  store.createTask("quota-crawl", "demo");
  store.createTask("quota-batch", "云端优先转写 / demo");
  store.updateTask("quota-batch", {
    summary_json: JSON.stringify({ provider: "cloud-first", totalCount: 1 }),
  });
  store.createTranscriptJob({
    id: "quota-job",
    taskId: "quota-batch",
    crawlTaskId: "quota-crawl",
    videoId: "quota-video",
    videoUrl: "https://example.com/quota",
    title: "quota",
    provider: "getnotes",
  });
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  store.updateTranscriptJob("quota-job", {
    provider_task_id: "provider-task",
    provider_started_at: now.toISOString(),
  });
  assert.equal(store.countCloudTranscriptJobsSince(dayStart), 1);
}

(async () => {
  try {
    await testFailureIsolationAndRetry();
    await testPauseAndResume();
    testCloudQuotaCounter();
    testRestartRecovery();
    console.log("transcription batch orchestration tests passed");
  } finally {
    store.closeTaskStore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
