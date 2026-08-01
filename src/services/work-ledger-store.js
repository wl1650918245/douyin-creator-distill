const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { RUNTIME_DIR, ensureDir } = require("../config/runtime-config");

ensureDir(RUNTIME_DIR);
const db = new DatabaseSync(path.join(RUNTIME_DIR, "agent-state.sqlite"));

db.exec(`CREATE TABLE IF NOT EXISTS works (
  source_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  creator_id TEXT,
  creator_name TEXT,
  content_type TEXT,
  title TEXT,
  video_url TEXT,
  publish_timestamp INTEGER,
  first_seen_run_id TEXT,
  last_seen_run_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  latest_snapshot_path TEXT,
  metadata_json TEXT,
  PRIMARY KEY (source_key, video_id)
);
CREATE TABLE IF NOT EXISTS crawl_run_works (
  run_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  seen_at TEXT NOT NULL,
  PRIMARY KEY (run_id, source_key, video_id)
);
CREATE TABLE IF NOT EXISTS work_processing_state (
  source_key TEXT NOT NULL,
  video_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  last_task_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_key, video_id, stage)
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,
  video_id TEXT,
  artifact_type TEXT NOT NULL,
  provider TEXT,
  output_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  task_id TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS task_checkpoints (
  task_id TEXT NOT NULL,
  checkpoint_key TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor TEXT,
  payload_json TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (task_id, checkpoint_key)
);
CREATE INDEX IF NOT EXISTS idx_works_source_last_seen ON works(source_key, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_processing_source_stage_status ON work_processing_state(source_key, stage, status);
CREATE INDEX IF NOT EXISTS idx_artifacts_source_video ON artifacts(source_key, video_id, artifact_type);`);

function now() { return new Date().toISOString(); }
function parseJson(value, fallback) { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } }
function sourceKeyFromTask(task) {
  if (!task) return "";
  if (task.source_mode === "favorites") return `favorites:${task.profile_id || "favorites-default"}`;
  return `creator:${String(task.source || "").trim().toLowerCase()}`;
}
function taskRow(taskId) { return db.prepare("SELECT * FROM tasks WHERE id=?").get(taskId) || null; }
function workVideoId(work) { return String(work?.videoId || work?.awemeId || work?.id || "").trim(); }
function workUrl(work) { return String(work?.videoUrl || work?.shareUrl || "").trim(); }
function registerArtifact({ sourceKey, videoId = null, artifactType, provider = null, outputPath, status = "completed", taskId = null, metadata = null }) {
  if (!sourceKey || !outputPath) return null;
  const resolved = path.resolve(outputPath); const time = now();
  db.prepare(`INSERT INTO artifacts (id,source_key,video_id,artifact_type,provider,output_path,status,task_id,metadata_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(output_path) DO UPDATE SET source_key=excluded.source_key, video_id=excluded.video_id,
      artifact_type=excluded.artifact_type, provider=excluded.provider, status=excluded.status,
      task_id=excluded.task_id, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
    .run(crypto.randomUUID(), sourceKey, videoId ? String(videoId) : null, artifactType, provider, resolved, status, taskId, metadata ? JSON.stringify(metadata) : null, time, time);
  return db.prepare("SELECT * FROM artifacts WHERE output_path=?").get(resolved);
}
function ingestCrawlArtifact({ taskId, runId, outputPath, auditStatus, seenAt = null }) {
  if (!outputPath || !fs.existsSync(outputPath)) return { sourceKey: "", imported: 0, total: 0 };
  const task = taskRow(taskId); const sourceKey = sourceKeyFromTask(task);
  if (!sourceKey) return { sourceKey: "", imported: 0, total: 0 };
  const evidenceRunId = String(runId || `task:${taskId}`); const time = seenAt || now();
  registerArtifact({ sourceKey, artifactType: "crawl-json", outputPath, status: auditStatus || "unknown", taskId, metadata: { runId: evidenceRunId, auditStatus } });
  if (auditStatus !== "passed") return { sourceKey, imported: 0, total: 0 };
  const data = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
  const works = Array.isArray(data.works) ? data.works : [];
  const upsertWork = db.prepare(`INSERT INTO works (source_key,video_id,source_type,creator_id,creator_name,content_type,title,video_url,publish_timestamp,first_seen_run_id,last_seen_run_id,first_seen_at,last_seen_at,latest_snapshot_path,metadata_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(source_key,video_id) DO UPDATE SET
      creator_id=CASE WHEN excluded.creator_id!='' THEN excluded.creator_id ELSE works.creator_id END,
      creator_name=CASE WHEN excluded.creator_name!='' THEN excluded.creator_name ELSE works.creator_name END,
      content_type=CASE WHEN excluded.content_type!='' THEN excluded.content_type ELSE works.content_type END,
      title=CASE WHEN excluded.title!='' THEN excluded.title ELSE works.title END,
      video_url=CASE WHEN excluded.video_url!='' THEN excluded.video_url ELSE works.video_url END,
      publish_timestamp=COALESCE(excluded.publish_timestamp,works.publish_timestamp),
      last_seen_run_id=excluded.last_seen_run_id,last_seen_at=excluded.last_seen_at,
      latest_snapshot_path=excluded.latest_snapshot_path,metadata_json=excluded.metadata_json`);
  const linkRun = db.prepare("INSERT OR IGNORE INTO crawl_run_works (run_id,source_key,video_id,seen_at) VALUES (?,?,?,?)");
  let imported = 0;
  db.exec("BEGIN");
  try {
    for (const work of works) {
      const videoId = workVideoId(work); if (!videoId) continue;
      const existing = db.prepare("SELECT 1 FROM works WHERE source_key=? AND video_id=?").get(sourceKey, videoId);
      upsertWork.run(
        sourceKey, videoId, task.source_mode === "favorites" ? "favorites" : "creator",
        String(work.authorSecUid || work.authorUid || work.creatorId || ""),
        String(work.authorNickname || task.creator_name || ""),
        String(work.contentType || work.awemeType || ""),
        String(work.title || work.desc || ""), workUrl(work),
        Number.isFinite(Number(work.publishTimestamp)) ? Number(work.publishTimestamp) : null,
        evidenceRunId, evidenceRunId, time, time, path.resolve(outputPath), JSON.stringify(work),
      );
      linkRun.run(evidenceRunId, sourceKey, videoId, time);
      if (!existing) imported += 1;
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { sourceKey, imported, total: works.length };
}
function aggregateTranscriptState(sourceKey, videoId) {
  const candidates = db.prepare("SELECT * FROM transcript_jobs WHERE video_id=? ORDER BY updated_at DESC").all(String(videoId))
    .filter((job) => sourceKeyFromTask(taskRow(job.crawl_task_id)) === sourceKey);
  if (!candidates.length) return null;
  const status = candidates.some((job) => job.status === "completed") ? "completed"
    : candidates.some((job) => job.status === "running") ? "running"
      : candidates.some((job) => job.status === "queued") ? "queued"
        : candidates.some((job) => job.status === "paused") ? "paused" : "failed";
  const latest = candidates[0]; const attempts = candidates.reduce((sum, job) => sum + Number(job.attempt_count || 0), 0);
  return { status, latest, attempts, candidates };
}
function syncTranscriptState(jobId) {
  const job = db.prepare("SELECT * FROM transcript_jobs WHERE id=?").get(jobId); if (!job) return null;
  const sourceKey = sourceKeyFromTask(taskRow(job.crawl_task_id)); if (!sourceKey) return null;
  const state = aggregateTranscriptState(sourceKey, job.video_id); if (!state) return null;
  const time = now(); const error = state.status === "completed" ? null : state.latest.error_message || null;
  db.prepare(`INSERT INTO work_processing_state (source_key,video_id,stage,status,last_task_id,attempt_count,last_error,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(source_key,video_id,stage) DO UPDATE SET status=excluded.status,last_task_id=excluded.last_task_id,
      attempt_count=excluded.attempt_count,last_error=excluded.last_error,updated_at=excluded.updated_at`)
    .run(sourceKey, String(job.video_id), "transcription", state.status, state.latest.task_id, state.attempts, error, time);
  for (const candidate of state.candidates.filter((entry) => entry.status === "completed")) {
    const files = [
      [candidate.output_path, "transcript-markdown"], [candidate.raw_output_path, "transcript-raw"],
      [candidate.srt_output_path, "transcript-srt"], [candidate.manifest_path, "transcript-manifest"],
    ];
    for (const [outputPath, artifactType] of files) {
      if (outputPath && fs.existsSync(outputPath)) registerArtifact({ sourceKey, videoId: candidate.video_id, artifactType, provider: candidate.provider, outputPath, taskId: candidate.task_id });
    }
  }
  return db.prepare("SELECT * FROM work_processing_state WHERE source_key=? AND video_id=? AND stage='transcription'").get(sourceKey, String(job.video_id));
}
function ensureCrawlTaskLedger(crawlTaskId) {
  const task = taskRow(crawlTaskId); if (!task?.output_path || !fs.existsSync(task.output_path)) return "";
  const sourceKey = sourceKeyFromTask(task);
  if (!db.prepare("SELECT 1 FROM works WHERE source_key=? LIMIT 1").get(sourceKey)) {
    ingestCrawlArtifact({ taskId: crawlTaskId, runId: `task:${crawlTaskId}`, outputPath: task.output_path, auditStatus: task.audit_status });
  }
  return sourceKey;
}
function filterProcessableWorks(crawlTaskId, works, stage = "transcription") {
  const sourceKey = ensureCrawlTaskLedger(crawlTaskId); const accepted = []; const skippedCompleted = []; const skippedActive = [];
  for (const work of works) {
    const videoId = workVideoId(work); if (!videoId) continue;
    const state = sourceKey ? db.prepare("SELECT * FROM work_processing_state WHERE source_key=? AND video_id=? AND stage=?").get(sourceKey, videoId, stage) : null;
    if (state?.status === "completed") skippedCompleted.push(videoId);
    else if (["queued", "running", "paused"].includes(state?.status)) skippedActive.push(videoId);
    else accepted.push(work);
  }
  return { sourceKey, works: accepted, skippedCompleted, skippedActive };
}
function saveTaskCheckpoint(taskId, checkpointKey, status, cursor = null, payload = null) {
  db.prepare(`INSERT INTO task_checkpoints (task_id,checkpoint_key,status,cursor,payload_json,updated_at)
    VALUES (?,?,?,?,?,?) ON CONFLICT(task_id,checkpoint_key) DO UPDATE SET status=excluded.status,
      cursor=excluded.cursor,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(taskId, checkpointKey, status, cursor ? String(cursor) : null, payload ? JSON.stringify(payload) : null, now());
  return db.prepare("SELECT * FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?").get(taskId, checkpointKey);
}
function getTaskCheckpoint(taskId, checkpointKey) {
  const row = db.prepare("SELECT * FROM task_checkpoints WHERE task_id=? AND checkpoint_key=?").get(taskId, checkpointKey);
  return row ? { ...row, payload: parseJson(row.payload_json, null) } : null;
}
function listWorkLedgerSummaries() {
  return db.prepare(`SELECT w.source_key,COUNT(*) AS total,
    SUM(CASE WHEN s.status='completed' THEN 1 ELSE 0 END) AS transcription_completed,
    SUM(CASE WHEN s.status IN ('queued','running','paused') THEN 1 ELSE 0 END) AS transcription_active,
    SUM(CASE WHEN s.status='failed' THEN 1 ELSE 0 END) AS transcription_failed,
    SUM(CASE WHEN s.status IS NULL THEN 1 ELSE 0 END) AS transcription_not_started,
    MAX(w.last_seen_at) AS last_seen_at
    FROM works w LEFT JOIN work_processing_state s
      ON s.source_key=w.source_key AND s.video_id=w.video_id AND s.stage='transcription'
    GROUP BY w.source_key ORDER BY w.source_key`).all().map((row) => ({
      sourceKey: row.source_key, total: Number(row.total || 0), transcriptionCompleted: Number(row.transcription_completed || 0),
      transcriptionActive: Number(row.transcription_active || 0), transcriptionFailed: Number(row.transcription_failed || 0),
      transcriptionNotStarted: Number(row.transcription_not_started || 0), lastSeenAt: row.last_seen_at,
    }));
}
function backfillStateLedger() {
  const runs = db.prepare(`SELECT r.id,r.task_id,r.output_path,r.audit_status,r.created_at FROM crawl_runs r
    WHERE r.audit_status='passed' ORDER BY r.created_at`).all();
  let worksImported = 0;
  for (const run of runs) {
    if (db.prepare("SELECT 1 FROM crawl_run_works WHERE run_id=? LIMIT 1").get(run.id)) continue;
    try {
      worksImported += ingestCrawlArtifact({
        taskId: run.task_id,
        runId: run.id,
        outputPath: run.output_path,
        auditStatus: run.audit_status,
        seenAt: run.created_at,
      }).imported;
    } catch { /* 原始证据损坏时不猜测。 */ }
  }
  const jobs = db.prepare("SELECT id FROM transcript_jobs ORDER BY updated_at").all();
  const visited = new Set();
  for (const { id } of jobs) {
    const job = db.prepare("SELECT crawl_task_id,video_id FROM transcript_jobs WHERE id=?").get(id); const sourceKey = sourceKeyFromTask(taskRow(job?.crawl_task_id)); const key = `${sourceKey}\u0000${job?.video_id || ""}`;
    if (!sourceKey || visited.has(key)) continue;
    visited.add(key);
    syncTranscriptState(id);
  }
  return { runs: runs.length, worksImported, transcriptStates: visited.size };
}
function closeWorkLedger() { db.close(); }

module.exports = {
  backfillStateLedger,
  closeWorkLedger,
  filterProcessableWorks,
  getTaskCheckpoint,
  ingestCrawlArtifact,
  listWorkLedgerSummaries,
  registerArtifact,
  saveTaskCheckpoint,
  sourceKeyFromTask,
  syncTranscriptState,
};
