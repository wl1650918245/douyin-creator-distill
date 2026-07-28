const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {
  ensureDir,
  getAccountCreatorAgentDir,
  getAccountTopicLibraryDir,
  sanitizeAccountSlug,
} = require("../config/runtime-config");
const {
  appendLog,
  createAgentReview,
  createCreatorAgent,
  createTask,
  createTopicBatch,
  getCreatorAgent,
  getTask,
  getTopicBatch,
  getViralReport,
  listCreatorAgents,
  listTasks,
  listTranscriptJobs,
  listViralReports,
  updateAgentReview,
  updateCreatorAgent,
  updateTask,
  updateTaskProgress,
  updateTopicBatch,
} = require("./task-store");

const MODEL_CONFIG_PATH = path.resolve(__dirname, "../../config/model.config.json");
const TOPIC_SKILL_PATH = path.resolve(__dirname, "../../skills/topic-advisor/SKILL.md");
const CREATOR_SKILL_PATH = path.resolve(__dirname, "../../skills/creator-agent/SKILL.md");
const MIN_AGENT_TRANSCRIPTS = 5;
const RECOMMENDED_AGENT_TRANSCRIPTS = 10;
const queue = [];
let active = false;

function modelConfig() {
  if (!fs.existsSync(MODEL_CONFIG_PATH)) throw new Error("缺少项目模型配置文件 config/model.config.json。");
  const config = JSON.parse(fs.readFileSync(MODEL_CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  const baseUrl = String(config.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "").trim();
  const model = String(config.model || "").trim();
  if (!baseUrl || !apiKey || !model) throw new Error("模型配置不完整，请在 config/model.config.json 填写 baseUrl、apiKey 和 model。");
  return { baseUrl, apiKey, model };
}

function endpointFor(baseUrl) {
  return baseUrl.endsWith("/v1") ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

function readSkill(filepath, label) {
  if (!fs.existsSync(filepath)) throw new Error(`缺少项目运行 Skill：${label}`);
  return fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, "").trim();
}

function modelErrorMessage(error) {
  const message = String(error?.response?.data?.error?.message || error?.response?.data?.message || error?.message || "分析模型请求失败");
  if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(message)) return "分析模型连接超时，请检查网络或系统代理后重试。";
  if (/ENOTFOUND|EAI_AGAIN/i.test(message)) return "无法解析分析模型服务地址，请检查网络、DNS 或模型配置。";
  if (/ECONNREFUSED|ECONNRESET/i.test(message)) return "分析模型连接被拒绝或中断，请检查网络代理和模型服务状态。";
  return message;
}

async function callModel(system, user, maxTokens = 8192) {
  const config = modelConfig();
  const response = await axios.post(endpointFor(config.baseUrl), {
    model: config.model,
    temperature: 0.25,
    max_tokens: maxTokens,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
  }, {
    timeout: 180000,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
  });
  const content = String(response.data?.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("分析模型没有返回可用正文。");
  return { content, model: config.model, usage: response.data?.usage || null };
}

function filenameTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function localTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function parseJsonObject(content) {
  const cleaned = content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("模型没有返回约定的 JSON 结构。");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validateTopics(payload, desiredCount, reports) {
  if (!payload || !Array.isArray(payload.topics)) throw new Error("模型返回缺少 topics 数组。");
  const allowedReportIds = new Set(reports.map((report) => String(report.id)));
  const allowedWorkIds = new Set(reports.flatMap((report) => report.workIds.map(String)));
  const topics = payload.topics.slice(0, desiredCount).map((topic, index) => ({
    id: crypto.randomUUID(),
    title: String(topic.title || "").trim(),
    hook: String(topic.hook || "").trim(),
    angle: String(topic.angle || "").trim(),
    audiencePain: String(topic.audiencePain || "").trim(),
    format: String(topic.format || "口播").trim(),
    confidence: Math.max(0, Math.min(100, Number(topic.confidence) || 0)),
    sourceReportIds: Array.isArray(topic.sourceReportIds) ? topic.sourceReportIds.map(String) : [],
    evidenceWorkIds: Array.isArray(topic.evidenceWorkIds) ? topic.evidenceWorkIds.map(String) : [],
    validationNeeded: Array.isArray(topic.validationNeeded) ? topic.validationNeeded.map((item) => String(item).trim()).filter(Boolean) : [],
    risk: String(topic.risk || "").trim(),
    status: "候选",
    order: index + 1,
  })).filter((topic) => topic.title && topic.hook && topic.angle);
  if (topics.length < Math.min(3, desiredCount)) throw new Error("模型返回的有效选题不足 3 条，请重新生成。");
  for (const topic of topics) {
    if (!topic.sourceReportIds.length || !topic.evidenceWorkIds.length) throw new Error(`选题“${topic.title}”缺少证据引用。`);
    const invalidReport = topic.sourceReportIds.find((id) => !allowedReportIds.has(id));
    const invalidWork = topic.evidenceWorkIds.find((id) => !allowedWorkIds.has(id));
    if (invalidReport || invalidWork) throw new Error(`选题“${topic.title}”引用了证据包之外的 ID。`);
  }
  return { positioning: String(payload.positioning || "").trim(), topics };
}

function topicReportMarkdown(batch, result, reports, model) {
  const sourceLines = reports.map((report) => `- ${report.id}｜${report.creator_name || report.douyin_id}｜${report.output_path}`).join("\n");
  const topicLines = result.topics.map((topic) => `## ${topic.order}. ${topic.title}\n\n- 开场钩子：${topic.hook}\n- 核心角度：${topic.angle}\n- 用户痛点：${topic.audiencePain || "待补充"}\n- 推荐形式：${topic.format}\n- 证据置信度：${topic.confidence}\n- 拍摄前核验：${topic.validationNeeded.join("；") || "无额外核验项"}\n- 误用风险：${topic.risk || "待人工复核"}\n- 来源报告：${topic.sourceReportIds.join(", ") || "见批次证据"}\n- 来源作品：${topic.evidenceWorkIds.join(", ") || "见来源报告"}\n- 状态：${topic.status}`).join("\n\n");
  return `---\nasset_type: ${yamlString("topic_batch")}\ncreated_at: ${yamlString(localTimestamp())}\nmodel: ${yamlString(model)}\nbatch_id: ${yamlString(batch.id)}\nsource_report_ids: ${JSON.stringify(batch.reportIds)}\ntopic_count: ${result.topics.length}\n---\n\n# 选题顾问输出\n\n## 内容定位\n\n${result.positioning || "基于已完成爆款拆解生成。"}\n\n## 证据来源\n\n${sourceLines}\n\n${topicLines}\n`;
}

function readCompletedReports(reportIds) {
  const requested = reportIds?.length ? [...new Set(reportIds.map(String))] : listViralReports().filter((report) => report.status === "completed").map((report) => report.id);
  const reports = requested.map(getViralReport).filter((report) => report?.status === "completed" && report.output_path && fs.existsSync(report.output_path));
  if (!reports.length) throw new Error("至少需要一份已完成的爆款拆解报告才能生成选题。");
  return reports;
}

function reportCreatorKey(report) {
  return String(report.douyin_id || report.creator_name || "unknown").trim().toLowerCase();
}

async function generateTopicBatch(item) {
  const reports = readCompletedReports(item.reportIds);
  const evidence = reports.map((report) => ({
    reportId: report.id,
    creator: report.creator_name || report.douyin_id,
    workIds: report.workIds,
    report: fs.readFileSync(report.output_path, "utf8").slice(0, 30000),
  }));
  const response = await callModel(
    readSkill(TOPIC_SKILL_PATH, "skills/topic-advisor/SKILL.md"),
    `请基于证据生成 ${item.count} 个可执行选题。只能引用证据中的 reportId 和 workIds。\n\n证据包：\n${JSON.stringify(evidence, null, 2)}`,
    8192,
  );
  const result = validateTopics(parseJsonObject(response.content), item.count, reports);
  const creatorKey = item.comparisonMode ? "cross-creator-comparison" : reportCreatorKey(reports[0]);
  const directory = getAccountTopicLibraryDir(sanitizeAccountSlug(creatorKey));
  ensureDir(directory);
  const outputPath = path.join(directory, `${filenameTimestamp()}-${result.topics.length}topics-${item.batchId.slice(0, 8)}.md`);
  const batch = getTopicBatch(item.batchId);
  fs.writeFileSync(outputPath, topicReportMarkdown(batch, result, reports, response.model), "utf8");
  return { ...result, outputPath, model: response.model, usage: response.usage, evidenceCount: reports.length, comparisonMode: item.comparisonMode, creators: [...new Set(reports.map(reportCreatorKey))] };
}

function creatorTranscriptGroups() {
  const tasksById = new Map(listTasks().map((task) => [task.id, task]));
  const groups = new Map();
  const chosen = new Map();
  for (const job of listTranscriptJobs().filter((item) => item.status === "completed" && item.output_path && fs.existsSync(item.output_path))) {
    const task = tasksById.get(job.crawl_task_id);
    if (!task?.source || task.source_mode === "favorites") continue;
    const key = `${String(task.source).toLowerCase()}:${job.video_id}`;
    const current = chosen.get(key);
    if (!current || (job.provider === "whisper" && current.job.provider !== "whisper")) chosen.set(key, { job, task });
  }
  for (const { job, task } of chosen.values()) {
    const douyinId = String(task.source).toLowerCase();
    if (!groups.has(douyinId)) groups.set(douyinId, { douyinId, creatorName: task.creator_name || task.source, transcripts: [] });
    groups.get(douyinId).transcripts.push(job);
  }
  return [...groups.values()].map((group) => {
    const latestAgent = listCreatorAgents().find((agent) => agent.douyin_id.toLowerCase() === group.douyinId && agent.status === "completed") || null;
    return { ...group, transcriptCount: group.transcripts.length, readiness: group.transcripts.length >= RECOMMENDED_AGENT_TRANSCRIPTS ? "ready" : group.transcripts.length >= MIN_AGENT_TRANSCRIPTS ? "trial" : "insufficient", latestAgent };
  }).sort((left, right) => right.transcriptCount - left.transcriptCount);
}

function creatorEvidence(douyinId) {
  const group = creatorTranscriptGroups().find((item) => item.douyinId === String(douyinId).toLowerCase());
  if (!group || group.transcriptCount < MIN_AGENT_TRANSCRIPTS) throw new Error(`至少需要 ${MIN_AGENT_TRANSCRIPTS} 条已转写代表作才能生成试用智能体。`);
  let totalChars = 0;
  const evidence = [];
  for (const job of group.transcripts.slice(0, 20)) {
    const content = fs.readFileSync(job.output_path, "utf8").replace(/^\uFEFF/, "");
    const remaining = Math.max(0, 70000 - totalChars);
    if (!remaining) break;
    const excerpt = content.slice(0, Math.min(10000, remaining));
    totalChars += excerpt.length;
    evidence.push({ transcriptId: job.id, videoId: job.video_id, title: job.title, provider: job.provider, outputPath: job.output_path, transcript: excerpt });
  }
  return { group, evidence };
}

function validateCreatorProfile(content, evidence) {
  const sectionStart = content.search(/^##\s*1\.\s*材料范围与证据质量/m);
  if (sectionStart < 0) throw new Error("模型画像缺少约定的第 1 节。");
  const profile = content.slice(sectionStart).trim();
  for (let section = 1; section <= 8; section += 1) {
    if (!new RegExp(`^##\\s*${section}\\.`, "m").test(profile)) throw new Error(`模型画像缺少第 ${section} 节。`);
  }
  const allowedTranscriptIds = new Set(evidence.map((entry) => String(entry.transcriptId)));
  const allowedVideoIds = new Set(evidence.map((entry) => String(entry.videoId)));
  const references = [...profile.matchAll(/\[(transcriptId|videoId):\s*([^\]]+)\]/g)];
  if (references.length < 8) throw new Error("模型画像的证据引用不足，未通过可审计门禁。");
  const invalid = references.filter(([, type, id]) => !(type === "transcriptId" ? allowedTranscriptIds : allowedVideoIds).has(id.trim()));
  if (invalid.length) throw new Error(`模型画像引用了材料包之外的 ID：${invalid[0][2].trim()}`);
  const longIds = [...profile.matchAll(/\b\d{18,20}\b/g)].map((match) => match[0]);
  const unknownVideoId = longIds.find((id) => !allowedVideoIds.has(id));
  if (unknownVideoId) throw new Error(`模型画像出现未提供的作品 ID：${unknownVideoId}`);
  return profile;
}

async function generateCreatorAgent(item) {
  const { group, evidence } = creatorEvidence(item.douyinId);
  const response = await callModel(
    readSkill(CREATOR_SKILL_PATH, "skills/creator-agent/SKILL.md"),
    `请基于下方材料生成“${group.creatorName}”的可审计智能体画像。每项重要判断都必须引用 transcriptId 或 videoId；材料不足时明确写“证据不足”。\n\n材料包：\n${JSON.stringify(evidence, null, 2)}`,
    8192,
  );
  const profile = validateCreatorProfile(response.content, evidence);
  const directory = getAccountCreatorAgentDir(sanitizeAccountSlug(item.douyinId));
  ensureDir(directory);
  const outputPath = path.join(directory, `${filenameTimestamp()}-creator-agent-${item.agentId.slice(0, 8)}.md`);
  const frontmatter = `---\nasset_type: ${yamlString("creator_agent")}\ncreated_at: ${yamlString(localTimestamp())}\ncreator: ${yamlString(group.creatorName)}\ndouyin_id: ${yamlString(group.douyinId)}\nmodel: ${yamlString(response.model)}\nagent_id: ${yamlString(item.agentId)}\ntranscript_ids: ${JSON.stringify(evidence.map((entry) => entry.transcriptId))}\nmaterial_count: ${evidence.length}\nquality_level: ${yamlString(evidence.length >= RECOMMENDED_AGENT_TRANSCRIPTS ? "正式画像" : "试用画像")}\n---`;
  fs.writeFileSync(outputPath, `${frontmatter}\n\n# ${group.creatorName} · 博主智能体画像\n\n> 这是基于 ${evidence.length} 条材料生成的${evidence.length >= RECOMMENDED_AGENT_TRANSCRIPTS ? "正式" : "试用"}画像，不代表博主本人。\n\n${profile}\n`, "utf8");
  return { outputPath, model: response.model, usage: response.usage, materialCount: evidence.length, transcriptIds: evidence.map((entry) => entry.transcriptId) };
}

function validateAgentReview(content) {
  const requiredSections = ["总评", "符合画像的地方", "偏离画像的地方", "逐段修改建议", "改写版本"];
  for (const section of requiredSections) {
    if (!new RegExp(`^#{2,4}\\s*${section}`, "m").test(content)) throw new Error(`审稿结果缺少“${section}”部分。`);
  }
  if (/合理推断|并非原始材料中出现|虚构.{0,8}(细节|案例|数据)/.test(content)) {
    throw new Error("审稿结果承认加入了原稿之外的事实，未通过可信度门禁。");
  }
  return content.trim();
}

async function generateAgentReview(item) {
  const agent = getCreatorAgent(item.agentId);
  if (!agent?.output_path || !fs.existsSync(agent.output_path)) throw new Error("博主智能体画像尚未生成。");
  const profile = fs.readFileSync(agent.output_path, "utf8").slice(0, 40000);
  const response = await callModel(
    readSkill(CREATOR_SKILL_PATH, "skills/creator-agent/SKILL.md"),
    `你正在使用已生成的博主画像审阅一篇新稿。不能冒充本人，也不能编造画像之外的偏好。画像里的旧作品事实只用于理解风格，绝对不能移植到待审稿件中，冒充作者的新经历、数据或测试结果。原稿没有提供的事实统一写成方括号占位符，例如 [补充真实案例] 或 [补充真实数据]。请输出：总评、符合画像的地方、偏离画像的地方、逐段修改建议、一个改写版本，并标明哪些建议有画像证据、哪些只是通用写作建议。\n\n博主画像：\n${profile}\n\n待审稿件：\n${item.draft}`,
    8192,
  );
  const review = validateAgentReview(response.content);
  const directory = path.dirname(agent.output_path);
  const outputPath = path.join(directory, `${filenameTimestamp()}-draft-review-${item.reviewId.slice(0, 8)}.md`);
  fs.writeFileSync(outputPath, `---\nasset_type: ${yamlString("creator_agent_review")}\ncreated_at: ${yamlString(localTimestamp())}\nagent_id: ${yamlString(agent.id)}\ncreator: ${yamlString(agent.creator_name)}\nmodel: ${yamlString(response.model)}\nreview_id: ${yamlString(item.reviewId)}\n---\n\n# ${agent.creator_name} · 稿件审阅\n\n## 原稿\n\n${item.draft}\n\n## 审阅结果\n\n${review}\n`, "utf8");
  return { outputPath, model: response.model, usage: response.usage, content: review };
}

async function run(item) {
  updateTask(item.taskId, { status: "running" });
  try {
    if (item.kind === "topic") {
      updateTopicBatch(item.batchId, { status: "running" });
      updateTaskProgress(item.taskId, { stage: "requesting_model", label: "选题顾问分析中", detail: `正在读取 ${item.reportIds.length || "全部"} 份爆款报告` });
      const result = await generateTopicBatch(item);
      updateTopicBatch(item.batchId, { status: "completed", model: result.model, topics_json: JSON.stringify(result.topics), output_path: result.outputPath, metadata_json: JSON.stringify({ positioning: result.positioning, usage: result.usage, evidenceCount: result.evidenceCount, comparisonMode: result.comparisonMode, creators: result.creators }) });
      updateTask(item.taskId, { status: "waiting_for_user", phase: "选题批次已生成", output_path: result.outputPath, summary_json: JSON.stringify({ provider: "topic-advisor", batchId: item.batchId, totalCount: result.topics.length }) });
      updateTaskProgress(item.taskId, { stage: "completed", label: "选题批次已保存", discovered: result.topics.length, expectedTotal: result.topics.length, detail: result.outputPath });
    } else if (item.kind === "agent") {
      updateCreatorAgent(item.agentId, { status: "running" });
      updateTaskProgress(item.taskId, { stage: "requesting_model", label: "博主智能体蒸馏中", detail: "正在提炼表达、判断和内容方法" });
      const result = await generateCreatorAgent(item);
      updateCreatorAgent(item.agentId, { status: "completed", model: result.model, transcript_ids_json: JSON.stringify(result.transcriptIds), output_path: result.outputPath, metadata_json: JSON.stringify({ usage: result.usage, materialCount: result.materialCount }) });
      updateTask(item.taskId, { status: "waiting_for_user", phase: "博主智能体已生成", output_path: result.outputPath, summary_json: JSON.stringify({ provider: "creator-agent", agentId: item.agentId, totalCount: result.materialCount }) });
      updateTaskProgress(item.taskId, { stage: "completed", label: "博主智能体画像已保存", discovered: result.materialCount, expectedTotal: result.materialCount, detail: result.outputPath });
    } else {
      updateAgentReview(item.reviewId, { status: "running" });
      updateTaskProgress(item.taskId, { stage: "requesting_model", label: "智能体正在审稿", detail: "正在核对画像证据与稿件表达" });
      const result = await generateAgentReview(item);
      updateAgentReview(item.reviewId, { status: "completed", model: result.model, output_path: result.outputPath, metadata_json: JSON.stringify({ usage: result.usage }) });
      updateTask(item.taskId, { status: "waiting_for_user", phase: "稿件审阅已完成", output_path: result.outputPath, summary_json: JSON.stringify({ provider: "creator-agent-review", reviewId: item.reviewId, agentId: item.agentId, totalCount: 1 }) });
      updateTaskProgress(item.taskId, { stage: "completed", label: "稿件审阅已保存", discovered: 1, expectedTotal: 1, detail: result.outputPath });
    }
    appendLog(item.taskId, `产物已保存：${getTask(item.taskId).output_path}`);
  } catch (error) {
    const message = modelErrorMessage(error);
    if (item.kind === "topic") updateTopicBatch(item.batchId, { status: "failed", error_message: message });
    else if (item.kind === "agent") updateCreatorAgent(item.agentId, { status: "failed", error_message: message });
    else updateAgentReview(item.reviewId, { status: "failed", error_message: message });
    updateTask(item.taskId, { status: "failed", phase: "分析任务失败", error_message: message });
    updateTaskProgress(item.taskId, { stage: "failed", label: "分析任务失败", detail: message });
    appendLog(item.taskId, `分析任务失败：${message}`);
  }
}

function pump() {
  if (active || !queue.length) return;
  active = true;
  run(queue.shift()).finally(() => { active = false; pump(); });
}

function submitTopicBatch({ reportIds = [], count = 12, comparisonMode = false }) {
  const reports = readCompletedReports(reportIds);
  const creators = [...new Set(reports.map(reportCreatorKey))];
  if (!comparisonMode && creators.length > 1) throw new Error("默认选题模式不能混合不同博主的报告；如需横向研究，请主动开启跨博主对比模式。");
  modelConfig();
  const taskId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const desiredCount = Math.max(3, Math.min(20, Number(count) || 12));
  const taskSource = comparisonMode ? "选题顾问 / 跨博主对比" : `选题顾问 / ${reports[0].creator_name || reports[0].douyin_id}`;
  createTask(taskId, taskSource);
  updateTask(taskId, { phase: "等待分析模型执行位", creator_name: comparisonMode ? "跨博主对比" : reports[0].creator_name, summary_json: JSON.stringify({ provider: "topic-advisor", batchId, totalCount: desiredCount, comparisonMode, creators }) });
  createTopicBatch({ id: batchId, taskId, reportIds: reports.map((report) => report.id) });
  queue.push({ kind: "topic", taskId, batchId, reportIds: reports.map((report) => report.id), count: desiredCount, comparisonMode });
  pump();
  return { taskId, batchId };
}

function submitCreatorAgent({ douyinId }) {
  const { group, evidence } = creatorEvidence(douyinId);
  const existing = listCreatorAgents().find((agent) => agent.douyin_id.toLowerCase() === group.douyinId && agent.status === "completed");
  if (existing) return { taskId: existing.task_id, agentId: existing.id, reused: true };
  modelConfig();
  const taskId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  createTask(taskId, `博主智能体 / ${group.douyinId}`);
  updateTask(taskId, { phase: "等待分析模型执行位", creator_name: group.creatorName, summary_json: JSON.stringify({ provider: "creator-agent", agentId, totalCount: evidence.length }) });
  createCreatorAgent({ id: agentId, taskId, douyinId: group.douyinId, creatorName: group.creatorName, transcriptIds: evidence.map((entry) => entry.transcriptId) });
  queue.push({ kind: "agent", taskId, agentId, douyinId: group.douyinId });
  pump();
  return { taskId, agentId };
}

function submitAgentReview({ agentId, draft }) {
  const agent = getCreatorAgent(agentId);
  if (!agent || agent.status !== "completed") throw new Error("请选择已完成的博主智能体后再审稿。");
  const text = String(draft || "").trim();
  if (text.length < 20 || text.length > 20000) throw new Error("稿件正文需在 20 至 20000 字之间。");
  modelConfig();
  const taskId = crypto.randomUUID();
  const reviewId = crypto.randomUUID();
  createTask(taskId, `智能体审稿 / ${agent.creator_name}`);
  updateTask(taskId, { phase: "等待分析模型执行位", creator_name: agent.creator_name, summary_json: JSON.stringify({ provider: "creator-agent-review", reviewId, agentId, totalCount: 1 }) });
  createAgentReview({ id: reviewId, taskId, agentId, draftExcerpt: text.slice(0, 120) });
  queue.push({ kind: "review", taskId, reviewId, agentId, draft: text });
  pump();
  return { taskId, reviewId };
}

function readArtifact(record) {
  let content = "";
  if (record?.status === "completed" && record.output_path && fs.existsSync(record.output_path)) content = fs.readFileSync(record.output_path, "utf8");
  return { ...record, content };
}

module.exports = {
  creatorTranscriptGroups,
  readArtifact,
  submitAgentReview,
  submitCreatorAgent,
  submitTopicBatch,
};
