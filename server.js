const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const { KNOWLEDGE_ASSET_ROOT } = require("./src/config/runtime-config");
const { resolveAccountRole } = require("./src/config/account-profiles");
const { reaudit, submit, submitFavoritesSelection } = require("./src/services/directory-crawl-service");
const cloudTranscription = require("./src/services/getnotes-transcription-service");
const hybridTranscription = require("./src/services/hybrid-transcription-service");
const localTranscription = require("./src/services/local-whisper-transcription-service");
const { validateTranscriptionRequest } = require("./src/services/transcription-request-policy");
const {
  addDistillationSources,
  deleteSubscription,
  getAgentReview,
  getCreatorAgent,
  getFavoritesDirectoryCache,
  getTask,
  getTopicBatch,
  getViralReport,
  listAgentReviews,
  listCreatorAgents,
  listDistillationSources,
  listRuns,
  listSubscriptions,
  listTasks,
  listTopicBatches,
  listTranscriptJobs,
  listTranscriptJobsForTask,
  listViralReports,
  updateSubscription,
} = require("./src/services/task-store");
const { runSubscriptionNow, startSubscriptionScheduler } = require("./src/services/subscription-scheduler");
const { MAX_WORKS_PER_REPORT, submitViralBreakdown } = require("./src/services/viral-breakdown-service");
const { creatorTranscriptGroups, readArtifact, submitAgentReview, submitCreatorAgent, submitTopicBatch } = require("./src/services/content-intelligence-service");
const { getSettings: getTranscriptionSettings, saveSettings: saveTranscriptionSettings } = require("./src/services/transcription-settings-service");
const { getAccountProfiles, launchAccountLogin, updateAccountProfiles } = require("./src/services/account-profile-service");

const root = __dirname; const host = "127.0.0.1"; const port = Number(process.env.PORT || 8780);
const API_VERSION = "2026-07-29.2";
const API_CAPABILITIES = ["account-profiles", "directory-crawl", "directory-crawl-loop", "favorites-directory", "favorites-directory-cache", "subscriptions", "scheduled-incremental-checks", "text-extraction", "local-whisper", "transcription-priority-fallback", "transcription-batch-pause-resume", "transcription-batch-retry", "transcription-checkpoint-recovery", "viral-breakdown", "viral-report-history", "topic-advisor", "creator-agent", "creator-draft-review", "creator-transcript-assets"];
const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
function json(response, status, body) { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store, max-age=0" }); response.end(JSON.stringify(body)); }
function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let rejected = false;
    request.on("data", (chunk) => {
      if (rejected) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 250000) {
        rejected = true;
        reject(new Error("请求内容超过 250 KB 限制"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (rejected) return;
      try { resolve(JSON.parse(body || "{}")); } catch { reject(new Error("请求 JSON 格式错误")); }
    });
  });
}
function openTranscriptFolder(taskId) {
  const task = getTask(taskId);
  if (!task || !["getnotes", "whisper", "cloud-first", "whisper-first"].includes(task.summary?.provider)) throw new Error("该任务不是文本提取任务");
  const assetRoot = path.resolve(KNOWLEDGE_ASSET_ROOT); const rootPrefix = `${assetRoot}${path.sep}`.toLowerCase();
  const folders = [...new Set(listTranscriptJobsForTask(taskId)
    .filter((entry) => entry.status === "completed" && entry.output_path && fs.existsSync(entry.output_path))
    .map((entry) => path.resolve(path.dirname(entry.output_path))))];
  if (!folders.length) throw new Error("该转写任务尚无可定位的本地文件");
  if (folders.some((folder) => !folder.toLowerCase().startsWith(rootPrefix))) throw new Error("转写文件不在知识资产目录中");
  folders.forEach((folder) => { const explorer = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore", windowsHide: false }); explorer.unref(); });
  return folders;
}
function openTaskOutputFolder(taskId) {
  const task = getTask(taskId);
  if (!task?.output_path || !fs.existsSync(task.output_path)) throw new Error("该目录任务尚无可定位的原始 JSON");
  const outputPath = path.resolve(task.output_path); const assetRoot = path.resolve(KNOWLEDGE_ASSET_ROOT); const rootPrefix = `${assetRoot}${path.sep}`.toLowerCase();
  if (!outputPath.toLowerCase().startsWith(rootPrefix)) throw new Error("原始 JSON 不在知识资产目录中");
  const folder = path.dirname(outputPath); const explorer = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore", windowsHide: false }); explorer.unref();
  return folder;
}
function transcriptionServiceForTask(taskId) {
  const task = getTask(taskId);
  if (!task) throw new Error("转写任务不存在");
  if (task.summary?.provider === "whisper") return localTranscription;
  if (task.summary?.provider === "getnotes") return cloudTranscription;
  if (["cloud-first", "whisper-first"].includes(task.summary?.provider)) return hybridTranscription;
  throw new Error("该任务不是可编排的转写批次");
}
function reportWithContent(reportId) {
  const report = getViralReport(reportId);
  if (!report) throw new Error("爆款拆解报告不存在");
  let content = "";
  if (report.status === "completed" && report.output_path && fs.existsSync(report.output_path)) content = fs.readFileSync(report.output_path, "utf8");
  return { ...report, content };
}
function openViralReportFolder(reportId) {
  const report = getViralReport(reportId);
  if (!report?.output_path || !fs.existsSync(report.output_path)) throw new Error("该报告尚无可定位的本地文件");
  const outputPath = path.resolve(report.output_path); const assetRoot = path.resolve(KNOWLEDGE_ASSET_ROOT); const rootPrefix = `${assetRoot}${path.sep}`.toLowerCase();
  if (!outputPath.toLowerCase().startsWith(rootPrefix)) throw new Error("报告文件不在知识资产目录中");
  const folder = path.dirname(outputPath); const explorer = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore", windowsHide: false }); explorer.unref();
  return folder;
}
function openArtifactFolder(record, label) {
  if (!record?.output_path || !fs.existsSync(record.output_path)) throw new Error(`${label}尚无可定位的本地文件`);
  const outputPath = path.resolve(record.output_path); const assetRoot = path.resolve(KNOWLEDGE_ASSET_ROOT); const rootPrefix = `${assetRoot}${path.sep}`.toLowerCase();
  if (!outputPath.toLowerCase().startsWith(rootPrefix)) throw new Error(`${label}文件不在知识资产目录中`);
  const folder = path.dirname(outputPath); const explorer = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore", windowsHide: false }); explorer.unref();
  return folder;
}
http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/health") return json(response, 200, { ok: true, apiVersion: API_VERSION, capabilities: API_CAPABILITIES, assetRoot: KNOWLEDGE_ASSET_ROOT });
    if (request.method === "GET" && url.pathname === "/api/tasks") return json(response, 200, { tasks: listTasks() });
    if (request.method === "GET" && url.pathname === "/api/runs") return json(response, 200, { runs: listRuns() });
    if (request.method === "GET" && url.pathname === "/api/viral-reports") return json(response, 200, { reports: listViralReports() });
    if (request.method === "GET" && /^\/api\/viral-reports\/[^/]+$/.test(url.pathname)) return json(response, 200, reportWithContent(url.pathname.split("/")[3]));
    if (request.method === "GET" && url.pathname === "/api/topic-batches") return json(response, 200, { batches: listTopicBatches() });
    if (request.method === "GET" && /^\/api\/topic-batches\/[^/]+$/.test(url.pathname)) {
      const batch = getTopicBatch(url.pathname.split("/")[3]);
      return batch ? json(response, 200, readArtifact(batch)) : json(response, 404, { error: "选题批次不存在" });
    }
    if (request.method === "GET" && url.pathname === "/api/creator-agent-readiness") return json(response, 200, { creators: creatorTranscriptGroups() });
    if (request.method === "GET" && url.pathname === "/api/creator-agents") return json(response, 200, { agents: listCreatorAgents() });
    if (request.method === "GET" && /^\/api\/creator-agents\/[^/]+$/.test(url.pathname)) {
      const agent = getCreatorAgent(url.pathname.split("/")[3]);
      return agent ? json(response, 200, readArtifact(agent)) : json(response, 404, { error: "博主智能体不存在" });
    }
    if (request.method === "GET" && url.pathname === "/api/agent-reviews") return json(response, 200, { reviews: listAgentReviews(url.searchParams.get("agentId") || "") });
    if (request.method === "GET" && /^\/api\/agent-reviews\/[^/]+$/.test(url.pathname)) {
      const review = getAgentReview(url.pathname.split("/")[3]);
      return review ? json(response, 200, readArtifact(review)) : json(response, 404, { error: "稿件审阅记录不存在" });
    }
    if (request.method === "GET" && url.pathname === "/api/transcript-jobs") return json(response, 200, { jobs: listTranscriptJobs(url.searchParams.get("crawlTaskId") || "", { all: url.searchParams.get("all") === "1" }) });
    if (request.method === "GET" && url.pathname === "/api/transcription-settings") return json(response, 200, getTranscriptionSettings());
    if (request.method === "GET" && url.pathname === "/api/account-profiles") return json(response, 200, getAccountProfiles());
    if (request.method === "GET" && url.pathname === "/api/favorites-directory-cache") {
      const profile = resolveAccountRole("favorites");
      const cache = getFavoritesDirectoryCache(profile.profileId, 1440);
      return json(response, 200, { cache, stale: !cache });
    }
    if (request.method === "GET" && url.pathname === "/api/subscriptions") return json(response, 200, { subscriptions: listSubscriptions() });
    if (request.method === "GET" && url.pathname === "/api/distillation-pool") { const crawlTaskId = url.searchParams.get("crawlTaskId") || ""; return json(response, 200, { sources: crawlTaskId ? listDistillationSources(crawlTaskId) : [] }); }
    if (request.method === "GET" && /^\/api\/tasks\/[^/]+\/works$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[3]; const task = getTask(taskId);
      if (!task) return json(response, 404, { error: "任务不存在" });
      if (!task.output_path || !fs.existsSync(task.output_path)) return json(response, 409, { error: "该任务尚未生成可读取的 JSON" });
      const data = JSON.parse(fs.readFileSync(task.output_path, "utf8"));
      return json(response, 200, { works: Array.isArray(data.works) ? data.works : [], totals: data.totals || {} });
    }
    if (request.method === "GET" && /^\/api\/tasks\/[^/]+\/favorite-collections$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[3]; const task = getTask(taskId);
      if (!task || task.source_mode !== "favorites") return json(response, 404, { error: "收藏夹目录发现任务不存在" });
      if (!task.output_path || !fs.existsSync(task.output_path)) return json(response, 409, { error: "收藏夹目录尚未生成" });
      const data = JSON.parse(fs.readFileSync(task.output_path, "utf8").replace(/^\uFEFF/, ""));
      return json(response, 200, { collections: Array.isArray(data.collections) ? data.collections : [], taskId: task.id, status: task.status });
    }
    if (request.method === "POST" && /^\/api\/tasks\/[^/]+\/re-audit$/.test(url.pathname)) return json(response, 200, reaudit(url.pathname.split("/")[3]));
    if (request.method === "GET" && url.pathname.startsWith("/api/tasks/")) { const task = getTask(url.pathname.split("/").pop()); return task ? json(response, 200, task) : json(response, 404, { error: "任务不存在" }); }
    if (request.method === "POST" && url.pathname === "/api/directory-crawls") {
      const { source, sourceMode } = await readJson(request);
      if (typeof source !== "string" || !source.trim() || source.length > 500) return json(response, 400, { error: "请输入有效的平台账号或作品链接" });
      const mode = ["profile", "single", "favorites"].includes(sourceMode) ? sourceMode : source.includes("/video/") || source.includes("v.douyin.com") ? "single" : source.includes("收藏") || source.includes("favorite") ? "favorites" : "profile";
      return json(response, 202, { taskId: submit(source.trim(), { sourceMode: mode, accountRole: mode === "favorites" ? "favorites" : "content" }) });
    }
    if (request.method === "POST" && url.pathname === "/api/favorites-crawls") {
      const { discoveryTaskId, collectionIds } = await readJson(request);
      if ((discoveryTaskId != null && typeof discoveryTaskId !== "string") || !Array.isArray(collectionIds)) return json(response, 400, { error: "请选择收藏夹后再开始抓取" });
      return json(response, 202, { taskId: submitFavoritesSelection(discoveryTaskId || "", collectionIds) });
    }
    if (request.method === "POST" && /^\/api\/subscriptions\/[^/]+\/check$/.test(url.pathname)) return json(response, 202, { taskId: runSubscriptionNow(url.pathname.split("/")[3]) });
    if (request.method === "PATCH" && /^\/api\/subscriptions\/[^/]+$/.test(url.pathname)) {
      const subscription = updateSubscription(url.pathname.split("/")[3], await readJson(request));
      return subscription ? json(response, 200, subscription) : json(response, 404, { error: "关注规则不存在" });
    }
    if (request.method === "DELETE" && /^\/api\/subscriptions\/[^/]+$/.test(url.pathname)) {
      const subscription = deleteSubscription(url.pathname.split("/")[3]);
      return subscription ? json(response, 200, { deleted: true, subscription, assetsPreserved: true }) : json(response, 404, { error: "关注规则不存在" });
    }
    if (request.method === "POST" && url.pathname === "/api/transcriptions") {
      const { crawlTaskId, videoIds, provider = "cloud-first" } = await readJson(request);
      const validationError = validateTranscriptionRequest({ crawlTaskId, videoIds, provider });
      if (validationError) return json(response, 400, { error: validationError });
      const taskId = provider === "whisper"
        ? localTranscription.submit(crawlTaskId, videoIds)
        : provider === "getnotes"
          ? cloudTranscription.submit(crawlTaskId, videoIds)
          : hybridTranscription.submit(crawlTaskId, videoIds, provider);
      return json(response, 202, { taskId, provider });
    }
    if (request.method === "POST" && /^\/api\/transcription-batches\/[^/]+\/pause$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[3];
      return json(response, 200, { task: transcriptionServiceForTask(taskId).pause(taskId) });
    }
    if (request.method === "POST" && /^\/api\/transcription-batches\/[^/]+\/resume$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[3];
      return json(response, 202, { task: transcriptionServiceForTask(taskId).resume(taskId) });
    }
    if (request.method === "POST" && /^\/api\/transcription-batches\/[^/]+\/retry-failed$/.test(url.pathname)) {
      const taskId = url.pathname.split("/")[3];
      return json(response, 202, transcriptionServiceForTask(taskId).retryFailed(taskId));
    }
    if (request.method === "POST" && url.pathname === "/api/transcription-settings") return json(response, 200, saveTranscriptionSettings(await readJson(request)));
    if (request.method === "POST" && url.pathname === "/api/account-profiles") return json(response, 200, updateAccountProfiles(await readJson(request)));
    if (request.method === "POST" && /^\/api\/account-profiles\/(content|favorites)\/login$/.test(url.pathname)) return json(response, 202, launchAccountLogin(url.pathname.split("/")[3]));
    if (request.method === "POST" && url.pathname === "/api/distillation-pool") { const { crawlTaskId, videoIds } = await readJson(request); const task = getTask(crawlTaskId); const completed = new Set(listTranscriptJobs(crawlTaskId).filter((job) => job.status === "completed").map((job) => String(job.video_id))); if (!task || task.status !== "waiting_for_user" || !Array.isArray(videoIds) || !videoIds.length || videoIds.some((id) => !completed.has(String(id)))) return json(response, 400, { error: "只能将已审核且已完成转写的作品加入蒸馏素材池" }); return json(response, 201, { sources: addDistillationSources(crawlTaskId, [...new Set(videoIds.map(String))]) }); }
    if (request.method === "POST" && /^\/api\/tasks\/[^/]+\/open-transcript-folder$/.test(url.pathname)) { const taskId = url.pathname.split("/")[3]; const folders = openTranscriptFolder(taskId); return json(response, 200, { ok: true, folder: folders[0], folders }); }
    if (request.method === "POST" && /^\/api\/tasks\/[^/]+\/open-output-folder$/.test(url.pathname)) return json(response, 200, { ok: true, folder: openTaskOutputFolder(url.pathname.split("/")[3]) });
    if (request.method === "POST" && /^\/api\/viral-reports\/[^/]+\/open-folder$/.test(url.pathname)) return json(response, 200, { ok: true, folder: openViralReportFolder(url.pathname.split("/")[3]) });
    if (request.method === "POST" && url.pathname === "/api/viral-breakdowns") { const { crawlTaskId, videoIds } = await readJson(request); if (typeof crawlTaskId !== "string" || !Array.isArray(videoIds) || !videoIds.length || videoIds.length > MAX_WORKS_PER_REPORT) return json(response, 400, { error: `请选择 1 至 ${MAX_WORKS_PER_REPORT} 条已转写作品后再拆解` }); return json(response, 202, submitViralBreakdown({ crawlTaskId, videoIds })); }
    if (request.method === "POST" && url.pathname === "/api/topic-batches") {
      const { reportIds = [], count = 12, comparisonMode = false } = await readJson(request);
      if (!Array.isArray(reportIds)) return json(response, 400, { error: "reportIds 必须是数组" });
      return json(response, 202, submitTopicBatch({ reportIds, count, comparisonMode: comparisonMode === true }));
    }
    if (request.method === "POST" && /^\/api\/topic-batches\/[^/]+\/open-folder$/.test(url.pathname)) return json(response, 200, { ok: true, folder: openArtifactFolder(getTopicBatch(url.pathname.split("/")[3]), "选题批次") });
    if (request.method === "POST" && url.pathname === "/api/creator-agents") {
      const { douyinId } = await readJson(request);
      if (typeof douyinId !== "string" || !douyinId.trim()) return json(response, 400, { error: "请选择有足够转写材料的博主" });
      return json(response, 202, submitCreatorAgent({ douyinId: douyinId.trim() }));
    }
    if (request.method === "POST" && /^\/api\/creator-agents\/[^/]+\/reviews$/.test(url.pathname)) {
      const { draft } = await readJson(request);
      return json(response, 202, submitAgentReview({ agentId: url.pathname.split("/")[3], draft }));
    }
    if (request.method === "POST" && /^\/api\/creator-agents\/[^/]+\/open-folder$/.test(url.pathname)) return json(response, 200, { ok: true, folder: openArtifactFolder(getCreatorAgent(url.pathname.split("/")[3]), "博主智能体") });
    if (request.method === "POST" && /^\/api\/agent-reviews\/[^/]+\/open-folder$/.test(url.pathname)) return json(response, 200, { ok: true, folder: openArtifactFolder(getAgentReview(url.pathname.split("/")[3]), "稿件审阅") });
  } catch (error) { return json(response, 400, { error: error.message }); }
  const relativePath = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, ""); const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(root + path.sep) || !fs.existsSync(filePath)) { response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); return response.end("Not found"); }
  response.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store, max-age=0" }); fs.createReadStream(filePath).pipe(response);
}).listen(port, host, () => {
  startSubscriptionScheduler();
  const recovered = cloudTranscription.recoverPending() + localTranscription.recoverPending() + hybridTranscription.recoverPending();
  console.log(`CreatorDistill: http://${host}:${port}`);
  if (recovered) console.log(`已从 SQLite 断点恢复 ${recovered} 个转写批次`);
});
