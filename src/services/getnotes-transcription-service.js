const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { getAccountGetNotesDir, ensureDir, sanitizeAccountSlug } = require("../config/runtime-config");
const { appendLog, createTask, createTranscriptJob, getTask, listTranscriptJobs, updateTask, updateTranscriptJob } = require("./task-store");
const { buildWorkAssetStem } = require("./transcript-naming");

const TEXT_EXTRACTION_CONFIG_PATH = path.resolve(__dirname, "../../config/text-extraction.config.json");

const queue = [];
let active = false;
let lastRequestAt = 0;

function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function rateLimit() { const wait = Math.max(0, 2000 - (Date.now() - lastRequestAt)); if (wait) await delay(wait); lastRequestAt = Date.now(); }
function parsePayload(raw) {
  const normalized = String(raw || "").replace(/("(?:id|note_id|next_cursor|task_id)"\s*:\s*)(\d{15,})/g, "$1\"$2\"");
  return JSON.parse(normalized);
}
async function apiRequest(method, endpoint, params, data) {
  if (!fs.existsSync(TEXT_EXTRACTION_CONFIG_PATH)) throw new Error("缺少项目文本提取配置文件 config/text-extraction.config.json。");
  const config = JSON.parse(fs.readFileSync(TEXT_EXTRACTION_CONFIG_PATH, "utf8").replace(/^\uFEFF/, ""));
  const apiBaseUrl = String(config.apiBaseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(config.apiKey || "").trim(); const clientId = String(config.clientId || "").trim();
  if (!apiBaseUrl || !apiKey || !clientId) throw new Error("请填写项目配置文件 config/text-extraction.config.json 的 apiBaseUrl、apiKey 和 clientId。");
  await rateLimit();
  const response = await axios.request({ method, url: `${apiBaseUrl}${endpoint}`, params, data, timeout: 60000, responseType: "text", headers: { Authorization: apiKey, "X-Client-ID": clientId, "Content-Type": "application/json" } });
  const payload = parsePayload(response.data);
  if (!payload?.success) throw new Error(payload?.error?.message || "Get笔记接口返回失败");
  return payload.data;
}
function hasContent(note) { return Boolean(String(note?.content || "").trim() || String(note?.web_page?.content || "").trim() || String(note?.audio?.original || "").trim()); }
async function waitForNote(taskId, directNoteId) {
  let noteId = taskId ? "" : (directNoteId ? String(directNoteId) : "");
  if (taskId) for (let attempt = 0; attempt < 40 && !noteId; attempt++) {
    const progress = await apiRequest("POST", "/resource/note/task/progress", undefined, { task_id: String(taskId) });
    const status = String(progress.status || "").toLowerCase();
    if (status === "failed" || status === "error") throw new Error(`Get笔记任务失败：${taskId}`);
    noteId = status === "success" && progress.note_id ? String(progress.note_id) : "";
    if (!noteId) await delay(20000);
  }
  if (!noteId) throw new Error(`Get笔记任务超时：${taskId}`);
  for (let attempt = 0; attempt < 40; attempt++) {
    const detail = await apiRequest("GET", "/resource/note/detail", { id: noteId }); const note = detail.note || detail;
    if (hasContent(note) || attempt === 39) return { noteId, note };
    await delay(20000);
  }
  throw new Error(`Get笔记详情超时：${noteId}`);
}
function yamlString(value) { return JSON.stringify(String(value ?? "")); }
function localTimestamp(date = new Date()) { const pad = (value) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`; }
function existingLocalCreatedAt(outputPath) { try { return fs.readFileSync(outputPath, "utf8").match(/^local_created_at:\s*"([^"]+)"/m)?.[1] || ""; } catch { return ""; } }
function noteTags(note, work) {
  const providerTags = Array.isArray(note.tags) ? note.tags.map((tag) => tag?.name || tag).filter(Boolean) : [];
  const douyinTags = Array.isArray(work?.hashtags) ? work.hashtags.map((tag) => String(tag).replace(/^#/, "")).filter(Boolean) : [];
  return [...new Set([...providerTags, ...douyinTags])];
}
function attachmentLines(note) {
  if (!Array.isArray(note.attachments) || !note.attachments.length) return "";
  return note.attachments.map((attachment) => {
    const url = String(attachment?.url || "").trim();
    return url ? `- [${attachment.title || url}](${url})` : "";
  }).filter(Boolean).join("\n");
}
function saveNote(crawlTask, job, note) {
  const account = sanitizeAccountSlug(crawlTask.source.split("/").at(-1) || "unknown-account"); const directory = getAccountGetNotesDir(account); ensureDir(directory);
  const crawlData = JSON.parse(fs.readFileSync(crawlTask.output_path, "utf8"));
  const work = (crawlData.works || []).find((item) => String(item.videoId) === String(job.video_id)) || {};
  const tags = noteTags(note, work);
  const durationSeconds = Number.isFinite(Number(work.durationMs)) ? Math.round(Number(work.durationMs) / 1000) : "";
  const filename = `${buildWorkAssetStem({ ...work, videoId: job.video_id, title: note.title || work.title || job.title })}.md`; const outputPath = path.join(directory, filename);
  const createdAt = note.created_at || ""; const updatedAt = note.updated_at || ""; const localCreatedAt = existingLocalCreatedAt(outputPath) || existingLocalCreatedAt(job.output_path) || localTimestamp(); const localUpdatedAt = localTimestamp();
  const frontmatter = `---\ntitle: ${yamlString(note.title || job.title)}\nnote_id: ${yamlString(note.id || note.note_id || "")}\nnote_type: ${yamlString(note.note_type || "link")}\nsource: ${yamlString("Get笔记")}\nsource_url: ${yamlString(job.video_url)}\ncreated_at: ${yamlString(createdAt)}\nupdated_at: ${yamlString(updatedAt)}\nlocal_created_at: ${yamlString(localCreatedAt)}\nlocal_updated_at: ${yamlString(localUpdatedAt)}\ndouyin_published_at: ${yamlString(work.date || "")}\ncreator: ${yamlString(work.authorNickname || "")}\ndouyin_id: ${yamlString(crawlTask.source)}\nvideo_id: ${yamlString(job.video_id)}\ncontent_type: ${yamlString(work.contentType || (work.hasImages ? "image" : "video"))}\nduration_seconds: ${yamlString(durationSeconds)}\nlikes: ${yamlString(work.likes || 0)}\ncomments: ${yamlString(work.commentCount || 0)}\ncollects: ${yamlString(work.collectCount || 0)}\nshares: ${yamlString(work.shareCount || 0)}\ninteraction_total: ${yamlString(work.interactionTotal || 0)}\ntags: ${JSON.stringify(tags)}\nprovider_task_id: ${yamlString(job.provider_task_id || "")}\n---`;
  const sections = [];
  if (String(note.content || "").trim()) sections.push(`## Get笔记整理内容\n\n${String(note.content).trim()}`);
  if (String(note.web_page?.content || "").trim()) sections.push(`## 音频转写\n\n${String(note.web_page.content).trim()}`);
  if (String(note.audio?.original || "").trim()) sections.push(`## 音频转写\n\n${String(note.audio.original).trim()}`);
  const attachments = attachmentLines(note); if (attachments) sections.push(`## 附件\n\n${attachments}`);
  const body = `${frontmatter}\n\n# ${note.title || job.title}\n\n${sections.join("\n\n")}\n`;
  fs.writeFileSync(outputPath, body, "utf8"); return outputPath;
}
async function processJob(crawlTask, taskId, job) {
  updateTranscriptJob(job.id, { status: "running" }); appendLog(taskId, `开始 Get笔记解析：${job.video_id}`);
  try {
    const created = await apiRequest("POST", "/resource/note/save", undefined, { note_type: "link", link_url: job.video_url });
    const providerTaskId = created.task_id || created.tasks?.[0]?.task_id || ""; const directNoteId = created.note_id || "";
    const { noteId, note } = await waitForNote(providerTaskId, directNoteId);
    const outputPath = saveNote(crawlTask, { ...job, provider_task_id: String(providerTaskId || "") }, note);
    updateTranscriptJob(job.id, { status: hasContent(note) ? "completed" : "partial", note_id: noteId, provider_task_id: String(providerTaskId || ""), output_path: outputPath });
    appendLog(taskId, `完成 Get笔记解析：${job.video_id}`);
  } catch (error) { updateTranscriptJob(job.id, { status: "failed", error_message: error.message }); appendLog(taskId, `失败：${job.video_id} - ${error.message}`); }
}
async function run(item) {
  const crawlTask = getTask(item.crawlTaskId); updateTask(item.taskId, { status: "running", phase: "Get笔记链接解析中" });
  for (const job of listTranscriptJobs(item.crawlTaskId).filter((entry) => entry.task_id === item.taskId)) await processJob(crawlTask, item.taskId, job);
  const jobs = listTranscriptJobs(item.crawlTaskId).filter((entry) => entry.task_id === item.taskId); const completed = jobs.filter((entry) => entry.status === "completed").length; const failed = jobs.filter((entry) => entry.status === "failed").length;
  updateTask(item.taskId, { status: failed ? "partial" : "waiting_for_user", phase: failed ? "Get笔记转写失败，未自动切换 Whisper" : "转写完成，等待你确认分析", summary_json: JSON.stringify({ totalCount: jobs.length, completed, failed, provider: "getnotes" }), error_message: failed ? `${failed} 条 Get笔记解析失败，未自动重试；Whisper 备用链尚未接入。` : null });
}
function pump() { if (active || !queue.length) return; active = true; const item = queue.shift(); run(item).catch((error) => updateTask(item.taskId, { status: "failed", phase: "转写任务失败", error_message: error.message })).finally(() => { active = false; pump(); }); }
function submit(crawlTaskId, videoIds) {
  const crawlTask = getTask(crawlTaskId); if (!crawlTask?.output_path || !fs.existsSync(crawlTask.output_path)) throw new Error("未找到已审核的 JSON，不能创建转写任务。");
  const data = JSON.parse(fs.readFileSync(crawlTask.output_path, "utf8")); const selected = new Set(videoIds.map(String)); const works = (data.works || []).filter((work) => selected.has(String(work.videoId)) && /^https?:\/\//.test(work.videoUrl || ""));
  if (!works.length) throw new Error("未选择有效的真实作品链接。");
  const taskId = crypto.randomUUID(); createTask(taskId, `Get笔记转写 / ${crawlTask.source}`, { sourceMode: crawlTask.source_mode || "profile", accountRole: crawlTask.account_role || "content", profileId: crawlTask.profile_id || null }); updateTask(taskId, { status: "queued", phase: "等待 Get笔记执行位", creator_name: crawlTask.creator_name || works.find((work) => work.authorNickname)?.authorNickname || "", summary_json: JSON.stringify({ totalCount: works.length, provider: "getnotes" }) });
  works.forEach((work) => createTranscriptJob({ id: crypto.randomUUID(), taskId, crawlTaskId, videoId: String(work.videoId), videoUrl: work.videoUrl, title: work.title || `未命名${work.hasImages || work.contentType === "image" ? "图文" : "视频"} · ${work.videoId}`, provider: "getnotes" }));
  queue.push({ taskId, crawlTaskId }); pump(); return taskId;
}
module.exports = { listTranscriptJobs, submit };
