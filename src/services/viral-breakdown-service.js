const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { ensureDir, getAccountViralBreakdownDir, sanitizeAccountSlug } = require("../config/runtime-config");
const { appendLog, createTask, createViralReport, getTask, listTranscriptJobs, updateTask, updateTaskProgress, updateViralReport } = require("./task-store");

const MAX_WORKS_PER_REPORT = 20;
const MODEL_CONFIG_PATH = path.resolve(__dirname, "../../config/model.config.json");
const VIRAL_BREAKDOWN_SKILL_PATH = path.resolve(__dirname, "../../skills/viral-breakdown/SKILL.md");
const queue = [];
let active = false;

function readCrawlWorks(task) {
  if (!task?.output_path || !fs.existsSync(task.output_path)) throw new Error("未找到已审核的原始 JSON，不能创建拆解报告。");
  const data = JSON.parse(fs.readFileSync(task.output_path, "utf8").replace(/^\uFEFF/, ""));
  return Array.isArray(data.works) ? data.works : [];
}

function latestCompletedJobs(crawlTaskId) {
  const latest = new Map();
  for (const job of listTranscriptJobs(crawlTaskId)) {
    if (job.status !== "completed" || !job.output_path || !fs.existsSync(job.output_path)) continue;
    const key = String(job.video_id);
    const existing = latest.get(key);
    const score = job.provider === "whisper" ? 2 : 1;
    const existingScore = existing?.provider === "whisper" ? 2 : existing ? 1 : 0;
    if (!existing || score > existingScore) latest.set(key, job);
  }
  return latest;
}

function formatNumber(value) { return Number(value || 0).toLocaleString("zh-CN"); }
function localTimestamp(date = new Date()) { const pad = (value) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function yamlString(value) { return JSON.stringify(String(value ?? "")); }
function modelErrorMessage(error) {
  const message = String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "分析模型请求失败");
  if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(message)) return "分析模型连接超时。请检查当前网络或系统代理是否能访问模型服务，然后重新拆解。";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "无法解析分析模型服务地址。请检查网络、DNS 或模型配置中的 baseUrl。";
  if (/ECONNREFUSED|ECONNRESET/i.test(message)) return "分析模型连接被拒绝或中断。请检查网络代理和模型服务状态后重试。";
  return message;
}

function modelConfig() {
  if (!fs.existsSync(MODEL_CONFIG_PATH)) throw new Error("缺少项目模型配置文件 config/model.config.json。请从 config/model.config.example.json 复制后填写。");
  const config = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "").trim();
  if (!baseUrl || !apiKey || !model) throw new Error("请填写项目配置文件 config/model.config.json 的 baseUrl、apiKey 和 model。");
  return { baseUrl, apiKey, model };
}

function endpointFor(baseUrl) { return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`; }

function runtimeSkill() {
  if (!fs.existsSync(VIRAL_BREAKDOWN_SKILL_PATH)) throw new Error("缺少项目运行 Skill：skills/viral-breakdown/SKILL.md。");
  return fs.readFileSync(VIRAL_BREAKDOWN_SKILL_PATH, "utf8").replace(/^\uFEFF/, "").trim();
}

function interactionTotal(work) {
  const declared = Number(work.interactionTotal);
  if (Number.isFinite(declared)) return declared;
  return Number(work.likes || 0) + Number(work.commentCount || 0) + Number(work.collectCount || 0) + Number(work.shareCount || 0);
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function accountBenchmark(works) {
  const ranked = [...works].sort((left, right) => interactionTotal(right) - interactionTotal(left));
  const rankByVideo = new Map(ranked.map((work, index) => [String(work.videoId), index + 1]));
  const medianInteractions = median(ranked.map(interactionTotal));
  return { workCount: ranked.length, medianInteractions, rankByVideo };
}

function buildEvidence(selectedWorks, jobsByVideo, benchmark) {
  return selectedWorks.map((work, index) => {
    const job = jobsByVideo.get(String(work.videoId));
    const interactions = interactionTotal(work);
    const accountRank = benchmark.rankByVideo.get(String(work.videoId));
    return {
      index: index + 1, videoId: String(work.videoId), title: work.title || `未命名${work.hasImages || work.contentType === "image" ? "图文" : "视频"} · ${work.videoId}`, publishedAt: work.date || "", type: work.contentType || "",
      metrics: { likes: Number(work.likes || 0), comments: Number(work.commentCount || 0), collects: Number(work.collectCount || 0), shares: Number(work.shareCount || 0), interactions },
      accountPosition: {
        rank: accountRank,
        workCount: benchmark.workCount,
        topPercent: benchmark.workCount ? Number(((accountRank / benchmark.workCount) * 100).toFixed(1)) : null,
        medianInteractions: benchmark.medianInteractions,
        versusMedian: benchmark.medianInteractions ? Number((interactions / benchmark.medianInteractions).toFixed(2)) : null,
      },
      description: work.description || "", sourceUrl: work.videoUrl || "", transcriptPath: job.output_path,
      transcript: fs.readFileSync(job.output_path, "utf8").replace(/^\uFEFF/, ""),
    };
  });
}

function analysisPrompt(crawlTask, evidence) {
  return `请严格执行系统消息中的项目 Skill，基于下方证据生成爆款拆解报告。\n\n账号：${crawlTask.creator_name || crawlTask.source}\n抖音号：${crawlTask.source}\n\n证据包：\n${JSON.stringify(evidence, null, 2)}`;
}

function evidenceMarkdown(evidence) {
  return evidence.map((item) => `- ${item.videoId}｜${item.title}\n  - 发布时间：${item.publishedAt || "未知"}；类型：${item.type || "未知"}\n  - 互动：赞 ${formatNumber(item.metrics.likes)}｜评 ${formatNumber(item.metrics.comments)}｜藏 ${formatNumber(item.metrics.collects)}｜转 ${formatNumber(item.metrics.shares)}｜总互动 ${formatNumber(item.metrics.interactions)}\n  - 账号位置：第 ${item.accountPosition.rank} / ${item.accountPosition.workCount} 名｜前 ${item.accountPosition.topPercent}%｜账号中位数 ${formatNumber(item.accountPosition.medianInteractions)}｜中位数倍数 ${item.accountPosition.versusMedian ?? "不可计算"}\n  - 抖音链接：${item.sourceUrl}\n  - 转写证据：${item.transcriptPath}`).join("\n");
}

function prepareEvidence(crawlTaskId, videoIds) {
  if (!Array.isArray(videoIds) || videoIds.length < 1 || videoIds.length > MAX_WORKS_PER_REPORT) throw new Error(`请选择 1 至 ${MAX_WORKS_PER_REPORT} 条作品进行一次拆解。`);
  const crawlTask = getTask(crawlTaskId);
  if (!crawlTask || crawlTask.status !== "waiting_for_user") throw new Error("只允许对已审核通过的目录创建爆款拆解。");
  const selectedIds = [...new Set(videoIds.map(String))];
  const allWorks = readCrawlWorks(crawlTask);
  const selectedWorks = allWorks.filter((work) => selectedIds.includes(String(work.videoId)));
  if (selectedWorks.length !== selectedIds.length) throw new Error("所选作品不在当前已审核目录中。");
  const jobsByVideo = latestCompletedJobs(crawlTaskId);
  const missing = selectedWorks.filter((work) => !jobsByVideo.has(String(work.videoId)));
  if (missing.length) throw new Error(`有 ${missing.length} 条作品尚未完成 Get笔记转写，不能进入爆款拆解。`);
  return { crawlTask, selectedIds, evidence: buildEvidence(selectedWorks, jobsByVideo, accountBenchmark(allWorks)) };
}

function filenameTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function generateViralBreakdown({ crawlTaskId, videoIds, taskId, reportId }) {
  const { crawlTask, selectedIds, evidence } = prepareEvidence(crawlTaskId, videoIds);
  const config = modelConfig();
  const startedAt = Date.now();
  const response = await axios.post(endpointFor(config.baseUrl), { model: config.model, temperature: 0.25, max_tokens: 8192, messages: [{ role: "system", content: runtimeSkill() }, { role: "user", content: analysisPrompt(crawlTask, evidence) }] }, { timeout: 120000, headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" } });
  const report = String(response.data?.choices?.[0]?.message?.content || "").trim();
  if (!report) {
    const reasoningTokens = Number(response.data?.usage?.completion_tokens_details?.reasoning_tokens || 0);
    throw new Error(reasoningTokens ? `分析模型消耗了 ${reasoningTokens} 个推理 token，但没有返回报告正文。` : "分析模型没有返回可用报告正文。");
  }

  const directory = getAccountViralBreakdownDir(sanitizeAccountSlug(crawlTask.source || "unknown-account"));
  ensureDir(directory);
  const createdAt = localTimestamp();
  const outputPath = path.join(directory, `${filenameTimestamp()}-${selectedIds.length}works-${reportId.slice(0, 8)}.md`);
  const frontmatter = `---\nanalysis_type: ${yamlString("viral_breakdown")}\nanalysis_skill: ${yamlString("douyin-viral-breakdown@1.0.0")}\ncreated_at: ${yamlString(createdAt)}\ncreator: ${yamlString(crawlTask.creator_name || "")}\ndouyin_id: ${yamlString(crawlTask.source)}\nmodel: ${yamlString(config.model)}\nwork_ids: ${JSON.stringify(selectedIds)}\nsource_json: ${yamlString(crawlTask.output_path)}\nevidence_count: ${evidence.length}\ntask_id: ${yamlString(taskId)}\nreport_id: ${yamlString(reportId)}\n---`;
  fs.writeFileSync(outputPath, `${frontmatter}\n\n# 爆款拆解：${crawlTask.creator_name || crawlTask.source}\n\n## 证据清单\n\n${evidenceMarkdown(evidence)}\n\n${report}\n`, "utf8");
  return { outputPath, report, evidenceCount: evidence.length, model: config.model, durationMs: Date.now() - startedAt, usage: response.data?.usage || null };
}

async function run(item) {
  updateTask(item.taskId, { status: "running", phase: "正在准备分析证据" });
  updateViralReport(item.reportId, { status: "running" });
  updateTaskProgress(item.taskId, { stage: "loading_evidence", label: "读取 JSON 与转写证据", detail: `正在核对 ${item.videoIds.length} 条作品` });
  appendLog(item.taskId, `开始爆款拆解：${item.videoIds.length} 条作品`);
  try {
    updateTaskProgress(item.taskId, { stage: "requesting_model", label: "分析模型处理中", detail: "正在执行项目爆款拆解 Skill" });
    const result = await generateViralBreakdown(item);
    const metadata = { evidenceCount: result.evidenceCount, durationMs: result.durationMs, usage: result.usage };
    updateViralReport(item.reportId, { status: "completed", model: result.model, output_path: result.outputPath, metadata_json: JSON.stringify(metadata), error_message: null });
    updateTask(item.taskId, { status: "waiting_for_user", phase: "爆款拆解完成", output_path: result.outputPath, summary_json: JSON.stringify({ provider: "viral-breakdown", reportId: item.reportId, crawlTaskId: item.crawlTaskId, workIds: item.videoIds, totalCount: result.evidenceCount, durationMs: result.durationMs, usage: result.usage }) });
    updateTaskProgress(item.taskId, { stage: "completed", label: "爆款拆解报告已保存", discovered: result.evidenceCount, expectedTotal: result.evidenceCount, detail: result.outputPath });
    appendLog(item.taskId, `报告已保存：${result.outputPath}`);
  } catch (error) {
    const message = modelErrorMessage(error);
    updateViralReport(item.reportId, { status: "failed", error_message: message });
    updateTask(item.taskId, { status: "failed", phase: "爆款拆解失败", error_message: message });
    updateTaskProgress(item.taskId, { stage: "failed", label: "爆款拆解失败", detail: message });
    appendLog(item.taskId, `爆款拆解失败：${message}`);
  }
}

function pump() {
  if (active || !queue.length) return;
  active = true;
  const item = queue.shift();
  run(item).finally(() => { active = false; pump(); });
}

function submitViralBreakdown({ crawlTaskId, videoIds }) {
  const { crawlTask, selectedIds } = prepareEvidence(crawlTaskId, videoIds);
  modelConfig();
  const taskId = crypto.randomUUID();
  const reportId = crypto.randomUUID();
  createTask(taskId, `爆款拆解 / ${crawlTask.source}`);
  updateTask(taskId, { phase: "等待分析模型执行位", creator_name: crawlTask.creator_name || "", summary_json: JSON.stringify({ provider: "viral-breakdown", reportId, crawlTaskId, workIds: selectedIds, totalCount: selectedIds.length }) });
  createViralReport({ id: reportId, taskId, crawlTaskId, creatorName: crawlTask.creator_name || "", douyinId: crawlTask.source, workIds: selectedIds });
  queue.push({ taskId, reportId, crawlTaskId, videoIds: selectedIds });
  pump();
  return { taskId, reportId };
}

module.exports = { MAX_WORKS_PER_REPORT, submitViralBreakdown };
