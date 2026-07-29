const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { StringDecoder } = require("string_decoder");
const { exportDouyinCookies } = require("../adapters/douyin/cookie-exporter");
const { loadTranscriptionConfig } = require("../config/transcription-config");
const {
  RUNTIME_DIR,
  ensureDir,
  getAccountTranscriptDir,
  sanitizeAccountSlug,
} = require("../config/runtime-config");
const {
  appendLog,
  createTask,
  createTranscriptJob,
  getTask,
  updateTaskProgress,
  updateTranscriptJob,
} = require("./task-store");
const { createTranscriptionBatchOrchestrator } = require("./transcription-batch-orchestrator");
const { buildWorkAssetStem } = require("./transcript-naming");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PYTHON_PATH = path.join(PROJECT_ROOT, "runtime", "python", ".venv", "Scripts", "python.exe");
const WHISPER_WORKER = path.join(PROJECT_ROOT, "scripts", "whisper_worker.py");
const FFMPEG_PATH = path.join(PROJECT_ROOT, "runtime", "bin", "ffmpeg", "ffmpeg.exe");
const MODEL_PATH = path.join(PROJECT_ROOT, "runtime", "models", "faster-whisper-small");

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });
    let stdout = "";
    let stderr = "";
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const consumeStdout = (text) => {
      if (!text) return;
      stdout += text;
      options.onStdout?.(text);
    };
    const consumeStderr = (text) => {
      if (!text) return;
      stderr += text;
      options.onStderr?.(text);
    };
    child.stdout.on("data", (chunk) => {
      consumeStdout(stdoutDecoder.write(chunk));
    });
    child.stderr.on("data", (chunk) => {
      consumeStderr(stderrDecoder.write(chunk));
    });
    child.once("error", reject);
    child.once("close", (code) => {
      consumeStdout(stdoutDecoder.end());
      consumeStderr(stderrDecoder.end());
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error((stderr || stdout || `进程退出码 ${code}`).trim().slice(-2000)));
    });
  });
}

function assertRuntime() {
  const required = [PYTHON_PATH, WHISPER_WORKER, FFMPEG_PATH, path.join(MODEL_PATH, "model.bin")];
  const missing = required.filter((filepath) => !fs.existsSync(filepath));
  if (missing.length) throw new Error(`本地 Whisper 运行环境不完整，请先运行 npm run doctor。缺少：${missing.join("、")}`);
}

function readCrawlWorks(crawlTask) {
  const data = JSON.parse(fs.readFileSync(crawlTask.output_path, "utf8").replace(/^\uFEFF/, ""));
  return Array.isArray(data.works) ? data.works : [];
}

function metadataFor(crawlTask, work) {
  return {
    title: work.title || work.desc || `未命名视频 · ${work.videoId}`,
    video_id: String(work.videoId),
    video_url: work.videoUrl,
    published_at: work.date || "",
    creator: work.authorNickname || crawlTask.creator_name || "",
    douyin_id: crawlTask.source,
    content_type: work.contentType || (work.hasImages ? "image" : "video"),
    likes: work.likes || 0,
    comments: work.commentCount || 0,
    collects: work.collectCount || 0,
    shares: work.shareCount || 0,
    interaction_total: work.interactionTotal || 0,
  };
}

function writeManifest(directory, crawlTask, work, artifacts) {
  const filepath = path.join(directory, "manifest.json");
  let current = {};
  try { current = JSON.parse(fs.readFileSync(filepath, "utf8")); } catch {}
  const manifest = {
    schema_version: "1.0",
    source_platform: "douyin",
    creator: work.authorNickname || crawlTask.creator_name || "",
    douyin_id: crawlTask.source,
    video_id: String(work.videoId),
    video_url: work.videoUrl,
    published_at: work.date || "",
    title: work.title || work.desc || "",
    providers: { ...(current.providers || {}), whisper: artifacts },
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filepath, JSON.stringify(manifest, null, 2), "utf8");
  return filepath;
}

async function downloadMedia(taskId, job, cookiesPath) {
  const downloadDir = path.join(RUNTIME_DIR, "downloads", taskId, job.video_id);
  ensureDir(downloadDir);
  updateTaskProgress(taskId, { stage: "download", label: `正在下载作品 ${job.video_id}`, currentVideoId: job.video_id });
  await runProcess(PYTHON_PATH, [
    "-m", "yt_dlp",
    "--cookies", cookiesPath,
    "--no-playlist",
    "--no-progress",
    "--restrict-filenames",
    "-o", path.join(downloadDir, "source.%(ext)s"),
    job.video_url,
  ]);
  const mediaPath = fs.readdirSync(downloadDir)
    .map((name) => path.join(downloadDir, name))
    .find((filepath) => fs.statSync(filepath).isFile() && !filepath.endsWith(".part"));
  if (!mediaPath) throw new Error(`作品 ${job.video_id} 下载后没有生成媒体文件`);
  return { downloadDir, mediaPath };
}

async function transcribeMedia(taskId, job, crawlTask, work, mediaPath, destinationDir) {
  const config = loadTranscriptionConfig();
  const metadataPath = path.join(destinationDir, "source-metadata.json");
  fs.writeFileSync(metadataPath, JSON.stringify(metadataFor(crawlTask, work), null, 2), "utf8");
  let buffered = "";
  let completedEvent = null;
  await runProcess(PYTHON_PATH, [
    WHISPER_WORKER,
    "--input", mediaPath,
    "--output-dir", destinationDir,
    "--ffmpeg", FFMPEG_PATH,
    "--model-dir", MODEL_PATH,
    "--metadata", metadataPath,
    "--device", config.whisper.device,
    "--compute-type", config.whisper.computeType,
    "--language", config.whisper.language,
  ], {
    onStdout(chunk) {
      buffered += chunk;
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (event.stage === "completed") completedEvent = event;
          updateTaskProgress(taskId, {
            stage: event.stage,
            label: event.message,
            currentVideoId: job.video_id,
            seconds: event.seconds,
            segments: event.segments,
          });
        } catch {
          appendLog(taskId, line.trim());
        }
      }
    },
  });
  if (!completedEvent) throw new Error(`作品 ${job.video_id} 未返回 Whisper 完成事件`);
  return completedEvent;
}

async function processJob(taskId, crawlTask, work, job, cookiesPath) {
  appendLog(taskId, `开始本地 Whisper 转写：${job.video_id}`);
  const account = sanitizeAccountSlug(crawlTask.source.split("/").at(-1) || "unknown-account");
  const destinationDir = path.join(getAccountTranscriptDir(account), buildWorkAssetStem(work));
  ensureDir(destinationDir);
  let downloaded;
  try {
    downloaded = await downloadMedia(taskId, job, cookiesPath);
    const result = await transcribeMedia(taskId, job, crawlTask, work, downloaded.mediaPath, destinationDir);
    const manifestPath = writeManifest(destinationDir, crawlTask, work, {
      status: "completed",
      markdown_path: result.markdown_path,
      json_path: result.json_path,
      srt_path: result.srt_path,
      model: "faster-whisper-small",
      completed_at: new Date().toISOString(),
    });
    updateTranscriptJob(job.id, {
      status: "completed",
      output_path: result.markdown_path,
      raw_output_path: result.json_path,
      srt_output_path: result.srt_path,
      manifest_path: manifestPath,
      error_message: null,
    });
    appendLog(taskId, `完成本地 Whisper 转写：${job.video_id}`);
  } finally {
    const config = loadTranscriptionConfig();
    if (downloaded?.downloadDir && !config.whisper.retainDownloadedMedia) {
      fs.rmSync(downloaded.downloadDir, { recursive: true, force: true });
    }
  }
}

async function prepareBatch(item) {
  assertRuntime();
  const crawlTask = getTask(item.crawlTaskId);
  const works = readCrawlWorks(crawlTask);
  updateTaskProgress(item.taskId, { stage: "cookies", label: "正在读取专用抖音登录状态" });
  const cookiesPath = await exportDouyinCookies(crawlTask.account_role || "content");
  return { crawlTask, works, cookiesPath };
}

const orchestrator = createTranscriptionBatchOrchestrator({
  provider: "whisper",
  runningPhase: "本地 Whisper 全量批处理中",
  completedPhase: "本地 Whisper 全量转写完成",
  partialPhase: "本地 Whisper 部分失败，已保留成功结果",
  prepare: prepareBatch,
  async processJob({ taskId, job, context }) {
    const work = context.works.find((entry) => String(entry.videoId) === String(job.video_id));
    await processJob(taskId, context.crawlTask, work || {}, job, context.cookiesPath);
  },
  async cleanup({ taskId }) {
    if (!loadTranscriptionConfig().whisper.retainDownloadedMedia) {
      fs.rmSync(path.join(RUNTIME_DIR, "downloads", taskId), { recursive: true, force: true });
    }
  },
});

function submit(crawlTaskId, videoIds) {
  assertRuntime();
  const crawlTask = getTask(crawlTaskId);
  if (!crawlTask?.output_path || !fs.existsSync(crawlTask.output_path)) throw new Error("未找到已审核的 JSON，不能创建本地 Whisper 任务。");
  const selected = new Set(videoIds.map(String));
  const works = readCrawlWorks(crawlTask).filter((work) => selected.has(String(work.videoId)));
  if (!works.length) throw new Error("没有选择有效作品。");
  if (works.some((work) => work.hasImages || work.contentType === "image")) throw new Error("本地 Whisper 只处理视频；图文作品请改用云端链接提取。");

  const taskId = crypto.randomUUID();
  createTask(taskId, `Whisper转写 / ${crawlTask.source}`, {
    sourceMode: crawlTask.source_mode || "profile",
    accountRole: crawlTask.account_role || "content",
    profileId: crawlTask.profile_id || null,
  });
  updateTask(taskId, {
    status: "queued",
    phase: "等待本地 Whisper 执行位",
    creator_name: crawlTask.creator_name || works.find((work) => work.authorNickname)?.authorNickname || "",
    summary_json: JSON.stringify({ totalCount: works.length, provider: "whisper" }),
  });
  for (const work of works) {
    createTranscriptJob({
      id: crypto.randomUUID(),
      taskId,
      crawlTaskId,
      videoId: String(work.videoId),
      videoUrl: work.videoUrl,
      title: work.title || work.desc || `未命名视频 · ${work.videoId}`,
      provider: "whisper",
    });
  }
  orchestrator.enqueue(taskId, crawlTaskId);
  return taskId;
}

module.exports = {
  pause: orchestrator.pause,
  recoverPending: orchestrator.recoverPending,
  resume: orchestrator.resume,
  retryFailed: orchestrator.retryFailed,
  submit,
};
