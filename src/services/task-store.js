const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { RUNTIME_DIR, ensureDir } = require("../config/runtime-config");
const { MAX_TOTAL_ATTEMPTS, canRetryTranscriptJob } = require("./transcription-error-policy");

ensureDir(RUNTIME_DIR);
const db = new DatabaseSync(path.join(RUNTIME_DIR, "agent-state.sqlite"));
db.exec(`CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, source TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, log TEXT NOT NULL DEFAULT '', error_message TEXT, output_path TEXT, audit_status TEXT, summary_json TEXT);
CREATE TABLE IF NOT EXISTS crawl_runs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, source TEXT NOT NULL, output_path TEXT NOT NULL, audit_status TEXT NOT NULL, total_count INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transcript_jobs (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, crawl_task_id TEXT NOT NULL, video_id TEXT NOT NULL, video_url TEXT NOT NULL, title TEXT NOT NULL, provider TEXT NOT NULL, status TEXT NOT NULL, note_id TEXT, provider_task_id TEXT, output_path TEXT, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS distillation_sources (crawl_task_id TEXT NOT NULL, video_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (crawl_task_id, video_id));
CREATE TABLE IF NOT EXISTS viral_reports (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, crawl_task_id TEXT NOT NULL, creator_name TEXT NOT NULL, douyin_id TEXT NOT NULL, status TEXT NOT NULL, model TEXT, work_ids_json TEXT NOT NULL, output_path TEXT, error_message TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS topic_batches (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, status TEXT NOT NULL, model TEXT, report_ids_json TEXT NOT NULL, topics_json TEXT, output_path TEXT, error_message TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS creator_agents (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, douyin_id TEXT NOT NULL, creator_name TEXT NOT NULL, status TEXT NOT NULL, model TEXT, transcript_ids_json TEXT NOT NULL, output_path TEXT, error_message TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agent_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent_id TEXT NOT NULL, status TEXT NOT NULL, model TEXT, draft_excerpt TEXT NOT NULL, output_path TEXT, error_message TEXT, metadata_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS favorites_directory_cache (profile_id TEXT PRIMARY KEY, collections_json TEXT NOT NULL, output_path TEXT, refreshed_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, display_name TEXT NOT NULL, account_role TEXT NOT NULL, profile_id TEXT, collection_ids_json TEXT, enabled INTEGER NOT NULL DEFAULT 1, check_interval_minutes INTEGER NOT NULL DEFAULT 1440, last_checked_at TEXT, last_success_at TEXT, next_check_at TEXT, last_error TEXT, last_result_json TEXT, baseline_output_path TEXT, deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS task_attempts (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, attempt_no INTEGER NOT NULL, strategy TEXT NOT NULL, status TEXT NOT NULL, error_class TEXT, error_message TEXT, output_path TEXT, audit_status TEXT, metadata_json TEXT, started_at TEXT NOT NULL, completed_at TEXT);`);
try { db.exec("ALTER TABLE tasks ADD COLUMN progress_json TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN progress_history_json TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN creator_name TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN raw_output_path TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN srt_output_path TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN manifest_path TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN last_started_at TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN provider_started_at TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN error_class TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN retryable INTEGER"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE transcript_jobs ADD COLUMN terminal_reason TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN source_mode TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN account_role TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN profile_id TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE tasks ADD COLUMN options_json TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
try { db.exec("ALTER TABLE subscriptions ADD COLUMN deleted_at TEXT"); } catch (error) { if (!String(error.message).includes("duplicate column")) throw error; }
db.prepare(`UPDATE transcript_jobs SET provider_started_at=created_at
  WHERE provider='getnotes' AND provider_started_at IS NULL
    AND (COALESCE(provider_task_id,'') != '' OR COALESCE(note_id,'') != '')`).run();
db.prepare(`UPDATE transcript_jobs
  SET error_class='provider_task_failed', retryable=0, terminal_reason=error_message
  WHERE status IN ('failed','partial') AND error_class IS NULL
    AND error_message LIKE '%任务失败：%'`).run();
const workLedger = require("./work-ledger-store");

function syncWorkLedger(jobId) {
  try { workLedger.syncTranscriptState(jobId); }
  catch (error) { console.error(`作品总账同步失败，将在服务重启时回填：${error.message}`); }
}

function repairWhisperProgressEncoding() {
  const labels = {
    cookies: "正在读取专用抖音登录状态",
    download: "正在下载作品",
    extract_audio: "正在使用项目内 FFmpeg 提取音频",
    load_model: "正在加载项目内 Whisper 模型",
    transcribe: "正在识别音频并生成时间轴",
    completed: "本地 Whisper 转写完成",
    partial: "本地 Whisper 转写部分失败",
    failed: "本地 Whisper 转写失败",
  };
  const normalize = (event) => {
    if (!event || !labels[event.stage]) return event;
    const suffix = event.stage === "download" && event.currentVideoId ? ` ${event.currentVideoId}` : "";
    return { ...event, label: `${labels[event.stage]}${suffix}` };
  };
  const rows = db.prepare("SELECT id, progress_json, progress_history_json FROM tasks WHERE source LIKE 'Whisper转写 / %'").all();
  const update = db.prepare("UPDATE tasks SET progress_json=?, progress_history_json=? WHERE id=?");
  for (const row of rows) {
    try {
      const progress = row.progress_json ? normalize(JSON.parse(row.progress_json)) : null;
      const history = row.progress_history_json
        ? JSON.parse(row.progress_history_json).map(normalize)
        : [];
      update.run(progress ? JSON.stringify(progress) : null, JSON.stringify(history), row.id);
    } catch {
      // Keep the original task record if a historic JSON payload is malformed.
    }
  }
}

repairWhisperProgressEncoding();
const startupTime = new Date().toISOString();
db.prepare("UPDATE transcript_jobs SET status='queued', error_message='服务重启后将从该作品继续', updated_at=? WHERE status='running'").run(startupTime);
db.prepare(`UPDATE tasks SET status='queued', phase='服务重启后等待断点继续', updated_at=?
  WHERE status IN ('queued','running')
    AND EXISTS (SELECT 1 FROM transcript_jobs WHERE transcript_jobs.task_id=tasks.id)`).run(startupTime);
db.prepare(`UPDATE tasks SET status='interrupted_recoverable', phase='服务重启中断', updated_at=?
  WHERE status IN ('queued','running')
    AND NOT EXISTS (SELECT 1 FROM transcript_jobs WHERE transcript_jobs.task_id=tasks.id)`).run(startupTime);
db.prepare("UPDATE viral_reports SET status='failed', error_message='服务重启中断，请重新提交拆解任务', updated_at=? WHERE status IN ('queued','running')").run(new Date().toISOString());
db.prepare("UPDATE topic_batches SET status='failed', error_message='服务重启中断，请重新生成选题', updated_at=? WHERE status IN ('queued','running')").run(new Date().toISOString());
db.prepare("UPDATE creator_agents SET status='failed', error_message='服务重启中断，请重新生成智能体', updated_at=? WHERE status IN ('queued','running')").run(new Date().toISOString());
db.prepare("UPDATE agent_reviews SET status='failed', error_message='服务重启中断，请重新审阅稿件', updated_at=? WHERE status IN ('queued','running')").run(new Date().toISOString());

function now() { return new Date().toISOString(); }
function nextCheckAt(intervalMinutes = 1440) {
  const interval = Math.max(60, Number(intervalMinutes) || 1440);
  const jitterMinutes = Math.floor(Math.random() * Math.min(15, Math.max(1, interval * 0.05)));
  return new Date(Date.now() + (interval + jitterMinutes) * 60000).toISOString();
}
function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
function createTask(id, source, context = {}) { const time = now(); db.prepare("INSERT INTO tasks (id,source,status,phase,created_at,updated_at,source_mode,account_role,profile_id,options_json) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, source, "queued", "等待 Chrome 执行位", time, time, context.sourceMode || null, context.accountRole || null, context.profileId || null, context.options ? JSON.stringify(context.options) : null); return getTask(id); }
function updateTask(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); const sets = entries.map(([key]) => `${key}=?`).join(", "); db.prepare(`UPDATE tasks SET ${sets} WHERE id=?`).run(...entries.map(([, value]) => value), id); return getTask(id); }
function appendLog(id, line) { const task = getTask(id); const log = `${task.log || ""}${line}\n`.slice(-12000); return updateTask(id, { log }); }
function updateTaskProgress(id, progress) {
  const task = getTask(id);
  const event = { at: progress.at || now(), ...progress };
  const history = [...(task?.progressHistory || []), event].slice(-16);
  return updateTask(id, { phase: event.label || "处理中", progress_json: JSON.stringify(event), progress_history_json: JSON.stringify(history) });
}
function creatorMetadataFromOutput(outputPath) {
  try {
    const data = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
    const work = data.works?.find((entry) => entry.authorNickname || entry.authorAvatarUrl) || {};
    return { name: work.authorNickname || "", avatarUrl: work.authorAvatarUrl || "" };
  } catch { return { name: "", avatarUrl: "" }; }
}
function inheritedCreatorName(taskId) {
  const parent = db.prepare("SELECT parent.creator_name, parent.output_path FROM transcript_jobs job JOIN tasks parent ON parent.id=job.crawl_task_id WHERE job.task_id=? LIMIT 1").get(taskId);
  return parent?.creator_name || creatorMetadataFromOutput(parent?.output_path).name;
}
function hydrateTask(row) {
  if (!row) return null;
  const metadata = creatorMetadataFromOutput(row.output_path);
  const creatorName = row.source_mode === "favorites" ? "我的收藏夹" : row.creator_name || metadata.name || inheritedCreatorName(row.id);
  return { ...row, creator_name: creatorName, creator_avatar_url: row.source_mode === "favorites" ? "" : metadata.avatarUrl, options: row.options_json ? JSON.parse(row.options_json) : null, summary: row.summary_json ? JSON.parse(row.summary_json) : null, progress: row.progress_json ? JSON.parse(row.progress_json) : null, progressHistory: row.progress_history_json ? JSON.parse(row.progress_history_json) : [] };
}
function getTask(id) { return hydrateTask(db.prepare("SELECT * FROM tasks WHERE id=?").get(id)); }
function listTasks() { return db.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT 500").all().map(hydrateTask); }
function createTaskAttempt(attempt) {
  const time = now();
  db.prepare("INSERT INTO task_attempts (id,task_id,attempt_no,strategy,status,metadata_json,started_at) VALUES (?,?,?,?,?,?,?)")
    .run(attempt.id, attempt.taskId, attempt.attemptNo, attempt.strategy, "running", JSON.stringify(attempt.metadata || {}), time);
  return getTaskAttempt(attempt.id);
}
function updateTaskAttempt(id, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return getTaskAttempt(id);
  db.prepare(`UPDATE task_attempts SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`)
    .run(...entries.map(([, value]) => value), id);
  return getTaskAttempt(id);
}
function hydrateTaskAttempt(row) {
  return row ? { ...row, metadata: parseJson(row.metadata_json, {}) } : null;
}
function getTaskAttempt(id) { return hydrateTaskAttempt(db.prepare("SELECT * FROM task_attempts WHERE id=?").get(id)); }
function listTaskAttempts(taskId) { return db.prepare("SELECT * FROM task_attempts WHERE task_id=? ORDER BY attempt_no, started_at").all(taskId).map(hydrateTaskAttempt); }
function addRun(run) { db.prepare("INSERT INTO crawl_runs (id,task_id,source,output_path,audit_status,total_count,created_at) VALUES (?,?,?,?,?,?,?)").run(run.id, run.taskId, run.source, run.outputPath, run.auditStatus, run.totalCount, now()); }
function listRuns() { return db.prepare("SELECT * FROM crawl_runs ORDER BY created_at DESC LIMIT 100").all(); }
function createTranscriptJob(job) { const time = now(); db.prepare("INSERT INTO transcript_jobs (id,task_id,crawl_task_id,video_id,video_url,title,provider,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(job.id, job.taskId, job.crawlTaskId, job.videoId, job.videoUrl, job.title, job.provider, "queued", time, time); syncWorkLedger(job.id); return getTranscriptJob(job.id); }
function updateTranscriptJob(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); const sets = entries.map(([key]) => `${key}=?`).join(", "); db.prepare(`UPDATE transcript_jobs SET ${sets} WHERE id=?`).run(...entries.map(([, value]) => value), id); syncWorkLedger(id); return getTranscriptJob(id); }
function getTranscriptJob(id) { return db.prepare("SELECT * FROM transcript_jobs WHERE id=?").get(id) || null; }
function listTranscriptJobs(crawlTaskId, options = {}) {
  if (crawlTaskId) return db.prepare("SELECT * FROM transcript_jobs WHERE crawl_task_id=? ORDER BY created_at DESC").all(crawlTaskId);
  const sql = options.all
    ? "SELECT * FROM transcript_jobs ORDER BY created_at DESC"
    : "SELECT * FROM transcript_jobs ORDER BY created_at DESC LIMIT 500";
  return db.prepare(sql).all();
}
function listTranscriptJobsForTask(taskId) { return db.prepare("SELECT * FROM transcript_jobs WHERE task_id=? ORDER BY created_at ASC").all(taskId); }
function listRecoverableTranscriptTasks(provider) {
  return db.prepare(`SELECT DISTINCT tasks.* FROM tasks
    JOIN transcript_jobs ON transcript_jobs.task_id=tasks.id
    WHERE json_extract(tasks.summary_json,'$.provider')=? AND tasks.status='queued'
      AND transcript_jobs.status IN ('queued','running')
    ORDER BY tasks.created_at ASC`).all(provider).map(hydrateTask);
}
function countCloudTranscriptJobsSince(since) {
  const row = db.prepare(`SELECT COUNT(*) AS total FROM transcript_jobs
    WHERE provider='getnotes'
      AND (COALESCE(provider_task_id,'') != '' OR COALESCE(note_id,'') != '')
      AND provider_started_at>=?`).get(since);
  return Number(row?.total || 0);
}
function retryTranscriptJobs(taskId, retryOptions = {}) {
  const options = typeof retryOptions === "function"
    ? { providerResolver: retryOptions }
    : (retryOptions || {});
  const jobs = listTranscriptJobsForTask(taskId);
  const retryable = jobs.filter((job) => canRetryTranscriptJob(job)
    && (!options.retryFilter || options.retryFilter(job)));
  const statement = db.prepare(`UPDATE transcript_jobs
    SET status='queued', provider=?, error_message=NULL, error_class=NULL, retryable=NULL,
      terminal_reason=NULL, max_attempts=MIN(attempt_count+3, ?), updated_at=?
    WHERE id=?`);
  const time = now();
  retryable.forEach((job) => statement.run(
    options.providerResolver ? options.providerResolver(job) : job.provider,
    MAX_TOTAL_ATTEMPTS,
    time,
    job.id,
  ));
  return retryable.length;
}
function resetInterruptedTranscriptJobs(taskId) {
  db.prepare(`UPDATE transcript_jobs
    SET status='queued', error_message='服务重启后将从该作品继续', updated_at=?
    WHERE task_id=? AND status='running'`).run(now(), taskId);
  return listTranscriptJobsForTask(taskId);
}
function addDistillationSources(crawlTaskId, videoIds) { const statement = db.prepare("INSERT OR IGNORE INTO distillation_sources (crawl_task_id,video_id,created_at) VALUES (?,?,?)"); const time = now(); for (const videoId of videoIds) statement.run(crawlTaskId, String(videoId), time); return listDistillationSources(crawlTaskId); }
function listDistillationSources(crawlTaskId) { return db.prepare("SELECT * FROM distillation_sources WHERE crawl_task_id=? ORDER BY created_at DESC").all(crawlTaskId); }
function hydrateViralReport(row) { return row ? { ...row, workIds: JSON.parse(row.work_ids_json || "[]"), metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null } : null; }
function createViralReport(report) { const time = now(); db.prepare("INSERT INTO viral_reports (id,task_id,crawl_task_id,creator_name,douyin_id,status,work_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(report.id, report.taskId, report.crawlTaskId, report.creatorName || "", report.douyinId, "queued", JSON.stringify(report.workIds), time, time); return getViralReport(report.id); }
function updateViralReport(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); const sets = entries.map(([key]) => `${key}=?`).join(", "); db.prepare(`UPDATE viral_reports SET ${sets} WHERE id=?`).run(...entries.map(([, value]) => value), id); return getViralReport(id); }
function getViralReport(id) { return hydrateViralReport(db.prepare("SELECT * FROM viral_reports WHERE id=?").get(id)); }
function listViralReports() { return db.prepare("SELECT * FROM viral_reports ORDER BY created_at DESC LIMIT 100").all().map(hydrateViralReport); }
function hydrateTopicBatch(row) { return row ? { ...row, reportIds: parseJson(row.report_ids_json, []), topics: parseJson(row.topics_json, []), metadata: parseJson(row.metadata_json, null) } : null; }
function createTopicBatch(batch) { const time = now(); db.prepare("INSERT INTO topic_batches (id,task_id,status,report_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(batch.id, batch.taskId, "queued", JSON.stringify(batch.reportIds || []), time, time); return getTopicBatch(batch.id); }
function updateTopicBatch(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); db.prepare(`UPDATE topic_batches SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`).run(...entries.map(([, value]) => value), id); return getTopicBatch(id); }
function getTopicBatch(id) { return hydrateTopicBatch(db.prepare("SELECT * FROM topic_batches WHERE id=?").get(id)); }
function listTopicBatches() { return db.prepare("SELECT * FROM topic_batches ORDER BY created_at DESC LIMIT 100").all().map(hydrateTopicBatch); }
function hydrateCreatorAgent(row) { return row ? { ...row, transcriptIds: parseJson(row.transcript_ids_json, []), metadata: parseJson(row.metadata_json, null) } : null; }
function createCreatorAgent(agent) { const time = now(); db.prepare("INSERT INTO creator_agents (id,task_id,douyin_id,creator_name,status,transcript_ids_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)").run(agent.id, agent.taskId, agent.douyinId, agent.creatorName || agent.douyinId, "queued", JSON.stringify(agent.transcriptIds || []), time, time); return getCreatorAgent(agent.id); }
function updateCreatorAgent(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); db.prepare(`UPDATE creator_agents SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`).run(...entries.map(([, value]) => value), id); return getCreatorAgent(id); }
function getCreatorAgent(id) { return hydrateCreatorAgent(db.prepare("SELECT * FROM creator_agents WHERE id=?").get(id)); }
function listCreatorAgents() { return db.prepare("SELECT * FROM creator_agents ORDER BY created_at DESC LIMIT 100").all().map(hydrateCreatorAgent); }
function hydrateAgentReview(row) { return row ? { ...row, metadata: parseJson(row.metadata_json, null) } : null; }
function createAgentReview(review) { const time = now(); db.prepare("INSERT INTO agent_reviews (id,task_id,agent_id,status,draft_excerpt,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").run(review.id, review.taskId, review.agentId, "queued", review.draftExcerpt || "", time, time); return getAgentReview(review.id); }
function updateAgentReview(id, fields) { const entries = Object.entries({ ...fields, updated_at: now() }); db.prepare(`UPDATE agent_reviews SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`).run(...entries.map(([, value]) => value), id); return getAgentReview(id); }
function getAgentReview(id) { return hydrateAgentReview(db.prepare("SELECT * FROM agent_reviews WHERE id=?").get(id)); }
function listAgentReviews(agentId = "") { const rows = agentId ? db.prepare("SELECT * FROM agent_reviews WHERE agent_id=? ORDER BY created_at DESC LIMIT 50").all(agentId) : db.prepare("SELECT * FROM agent_reviews ORDER BY created_at DESC LIMIT 100").all(); return rows.map(hydrateAgentReview); }

function saveFavoritesDirectoryCache(profileId, collections, outputPath, refreshedAt = now()) {
  db.prepare(`INSERT INTO favorites_directory_cache (profile_id,collections_json,output_path,refreshed_at)
    VALUES (?,?,?,?)
    ON CONFLICT(profile_id) DO UPDATE SET collections_json=excluded.collections_json, output_path=excluded.output_path, refreshed_at=excluded.refreshed_at`)
    .run(String(profileId || "favorites-default"), JSON.stringify(collections || []), outputPath || null, refreshedAt);
  return getFavoritesDirectoryCache(profileId);
}

function getFavoritesDirectoryCache(profileId, maxAgeMinutes = null) {
  const key = String(profileId || "favorites-default");
  const row = db.prepare("SELECT * FROM favorites_directory_cache WHERE profile_id=?").get(key);
  if (!row) return null;
  const ageMinutes = Math.max(0, (Date.now() - new Date(row.refreshed_at).getTime()) / 60000);
  if (maxAgeMinutes !== null && ageMinutes > Number(maxAgeMinutes)) return null;
  return { profileId: row.profile_id, collections: parseJson(row.collections_json, []), outputPath: row.output_path, refreshedAt: row.refreshed_at, ageMinutes };
}

function subscriptionKey(task) {
  if (task.source_mode === "favorites") return `favorites:${task.profile_id || "favorites-default"}`;
  return `creator:${String(task.source || "").trim().toLowerCase()}`;
}

function hydrateSubscription(row) {
  return row ? {
    ...row,
    enabled: Boolean(row.enabled),
    collectionIds: parseJson(row.collection_ids_json, []),
    lastResult: parseJson(row.last_result_json, null),
  } : null;
}

function upsertSubscriptionFromTask(taskId, { reactivate = true } = {}) {
  const task = getTask(taskId);
  const sourceMode = task?.source_mode || (task?.audit_status === "passed" && task?.output_path ? "profile" : "");
  if (!task || !["profile", "favorites"].includes(sourceMode) || task.options?.kind === "favorites-discovery") return null;
  const time = now();
  const sourceType = sourceMode === "favorites" ? "favorites" : "creator";
  const sourceKey = subscriptionKey(task);
  const source = sourceType === "favorites" ? "我的收藏夹" : task.source;
  const displayName = sourceType === "favorites" ? "我的收藏夹" : task.creator_name || task.source;
  const collectionIds = sourceType === "favorites" ? task.options?.collectionIds || [] : [];
  db.prepare(`INSERT INTO subscriptions (id,source_type,source_key,source,display_name,account_role,profile_id,collection_ids_json,enabled,check_interval_minutes,next_check_at,baseline_output_path,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,1,1440,?,?,?,?)
    ON CONFLICT(source_key) DO UPDATE SET source=excluded.source, display_name=excluded.display_name, account_role=excluded.account_role, profile_id=excluded.profile_id, collection_ids_json=excluded.collection_ids_json, baseline_output_path=excluded.baseline_output_path, updated_at=excluded.updated_at`)
    .run(require("crypto").randomUUID(), sourceType, sourceKey, source, displayName, task.account_role || (sourceType === "favorites" ? "favorites" : "content"), task.profile_id || null, JSON.stringify(collectionIds), nextCheckAt(1440), task.output_path || null, time, time);
  if (reactivate) db.prepare("UPDATE subscriptions SET deleted_at=NULL, enabled=1, updated_at=? WHERE source_key=?").run(time, sourceKey);
  return getSubscriptionByKey(sourceKey);
}

function getSubscription(id) { return hydrateSubscription(db.prepare("SELECT * FROM subscriptions WHERE id=?").get(id)); }
function getSubscriptionByKey(sourceKey) { return hydrateSubscription(db.prepare("SELECT * FROM subscriptions WHERE source_key=?").get(sourceKey)); }
function listSubscriptions() { return db.prepare("SELECT * FROM subscriptions WHERE deleted_at IS NULL ORDER BY source_type, updated_at DESC").all().map(hydrateSubscription); }
function listDueSubscriptions(at = now()) { return db.prepare("SELECT * FROM subscriptions WHERE deleted_at IS NULL AND enabled=1 AND next_check_at IS NOT NULL AND next_check_at<=? ORDER BY next_check_at LIMIT 10").all(at).map(hydrateSubscription); }
function hasActiveSubscriptionTask(id) {
  return Boolean(db.prepare(`SELECT 1 FROM tasks
    WHERE status IN ('queued','running') AND json_extract(options_json,'$.subscriptionId')=?
    LIMIT 1`).get(id));
}

function updateSubscription(id, changes = {}) {
  const allowed = {};
  if (Object.hasOwn(changes, "enabled")) allowed.enabled = changes.enabled ? 1 : 0;
  if (Object.hasOwn(changes, "check_interval_minutes")) allowed.check_interval_minutes = Math.max(60, Math.min(43200, Number(changes.check_interval_minutes) || 1440));
  if (Object.hasOwn(changes, "display_name")) allowed.display_name = String(changes.display_name || "").trim();
  if (!Object.keys(allowed).length) return getSubscription(id);
  if (allowed.enabled === 1 || allowed.check_interval_minutes) allowed.next_check_at = nextCheckAt(allowed.check_interval_minutes || getSubscription(id)?.check_interval_minutes);
  const entries = Object.entries({ ...allowed, updated_at: now() });
  db.prepare(`UPDATE subscriptions SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`).run(...entries.map(([, value]) => value), id);
  return getSubscription(id);
}

function deleteSubscription(id) {
  const subscription = getSubscription(id);
  if (!subscription) return null;
  db.prepare("UPDATE subscriptions SET enabled=0, deleted_at=?, updated_at=? WHERE id=?").run(now(), now(), id);
  return subscription;
}

function markSubscriptionStarted(id) {
  const subscription = getSubscription(id);
  if (!subscription) return null;
  db.prepare("UPDATE subscriptions SET last_checked_at=?, next_check_at=?, last_error=NULL, updated_at=? WHERE id=?")
    .run(now(), nextCheckAt(subscription.check_interval_minutes), now(), id);
  return getSubscription(id);
}

function workIdsFromOutput(outputPath) {
  try {
    const data = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
    return new Set((data.works || []).map((work) => String(work.videoId || work.awemeId || work.id || "")).filter(Boolean));
  } catch { return new Set(); }
}

function completeSubscriptionCheck(id, outputPath) {
  const subscription = getSubscription(id);
  if (!subscription) return null;
  const previousIds = workIdsFromOutput(subscription.baseline_output_path);
  const currentIds = workIdsFromOutput(outputPath);
  const newCount = [...currentIds].filter((videoId) => !previousIds.has(videoId)).length;
  const removedCount = [...previousIds].filter((videoId) => !currentIds.has(videoId)).length;
  const result = { totalCount: currentIds.size, newCount, removedCount };
  db.prepare("UPDATE subscriptions SET last_success_at=?, last_error=NULL, last_result_json=?, baseline_output_path=?, updated_at=? WHERE id=?")
    .run(now(), JSON.stringify(result), outputPath || subscription.baseline_output_path, now(), id);
  return getSubscription(id);
}

function failSubscriptionCheck(id, message) {
  db.prepare("UPDATE subscriptions SET last_error=?, updated_at=? WHERE id=?").run(String(message || "检查失败"), now(), id);
  return getSubscription(id);
}

function backfillSubscriptions() {
  const rows = db.prepare(`SELECT id FROM tasks
    WHERE output_path IS NOT NULL AND status='waiting_for_user'
      AND (source_mode IN ('profile','favorites') OR (source_mode IS NULL AND audit_status='passed'))
      AND COALESCE(json_extract(options_json,'$.kind'),'') != 'favorites-discovery'
    ORDER BY updated_at ASC`).all();
  rows.forEach(({ id }) => upsertSubscriptionFromTask(id, { reactivate: false }));
}

function backfillFavoritesDirectoryCache() {
  const rows = db.prepare(`SELECT profile_id, output_path, updated_at FROM tasks
    WHERE source_mode='favorites' AND output_path IS NOT NULL
      AND json_extract(options_json,'$.kind')='favorites-discovery'
    ORDER BY updated_at DESC`).all();
  const visited = new Set();
  for (const row of rows) {
    const profileId = row.profile_id || "favorites-default";
    if (visited.has(profileId) || getFavoritesDirectoryCache(profileId)) continue;
    visited.add(profileId);
    try {
      const data = JSON.parse(fs.readFileSync(row.output_path, "utf8").replace(/^\uFEFF/, ""));
      if (Array.isArray(data.collections) && data.collections.length) saveFavoritesDirectoryCache(profileId, data.collections, row.output_path, row.updated_at);
    } catch {
      // Historic evidence remains untouched if it cannot seed the current cache.
    }
  }
}

backfillFavoritesDirectoryCache();
backfillSubscriptions();
try { workLedger.backfillStateLedger(); }
catch (error) { console.error(`作品总账历史回填失败，主任务数据保持可用：${error.message}`); }

function closeTaskStore() {
  db.close();
  workLedger.closeWorkLedger();
}

module.exports = {
  addDistillationSources,
  addRun,
  appendLog,
  closeTaskStore,
  completeSubscriptionCheck,
  countCloudTranscriptJobsSince,
  createTaskAttempt,
  createAgentReview,
  createCreatorAgent,
  createTask,
  createTopicBatch,
  createTranscriptJob,
  createViralReport,
  deleteSubscription,
  failSubscriptionCheck,
  getFavoritesDirectoryCache,
  getTaskAttempt,
  getAgentReview,
  getCreatorAgent,
  getSubscription,
  hasActiveSubscriptionTask,
  getTask,
  getTopicBatch,
  getTranscriptJob,
  getViralReport,
  listDistillationSources,
  listAgentReviews,
  listCreatorAgents,
  listDueSubscriptions,
  listRuns,
  listSubscriptions,
  listTasks,
  listTaskAttempts,
  listTopicBatches,
  listTranscriptJobs,
  listTranscriptJobsForTask,
  listRecoverableTranscriptTasks,
  listViralReports,
  markSubscriptionStarted,
  saveFavoritesDirectoryCache,
  updateSubscription,
  updateAgentReview,
  updateCreatorAgent,
  updateTask,
  updateTaskAttempt,
  updateTaskProgress,
  updateTopicBatch,
  updateTranscriptJob,
  updateViralReport,
  upsertSubscriptionFromTask,
  resetInterruptedTranscriptJobs,
  retryTranscriptJobs,
};
