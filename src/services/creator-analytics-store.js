const path = require("path");
const crypto = require("crypto");
const { DatabaseSync } = require("node:sqlite");
const { RUNTIME_DIR, ensureDir } = require("../config/runtime-config");

ensureDir(RUNTIME_DIR);
const db = new DatabaseSync(path.join(RUNTIME_DIR, "agent-state.sqlite"));
db.exec("PRAGMA busy_timeout=5000");
db.exec(`
  CREATE TABLE IF NOT EXISTS creator_analytics_settings (
    id INTEGER PRIMARY KEY CHECK (id=1),
    enabled INTEGER NOT NULL DEFAULT 0,
    check_interval_minutes INTEGER NOT NULL DEFAULT 1440,
    last_checked_at TEXT,
    last_success_at TEXT,
    next_check_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS creator_analytics_runs (
    id TEXT PRIMARY KEY,
    account_role TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    trigger_mode TEXT NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    error_message TEXT,
    summary_json TEXT,
    output_path TEXT,
    report_path TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT
  );
  CREATE TABLE IF NOT EXISTS creator_account_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL UNIQUE,
    profile_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    douyin_id TEXT,
    nickname TEXT NOT NULL,
    permission_status TEXT NOT NULL,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES creator_analytics_runs(id)
  );
  CREATE TABLE IF NOT EXISTS creator_work_snapshots (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    publish_timestamp TEXT,
    snapshot_at TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    FOREIGN KEY (run_id) REFERENCES creator_analytics_runs(id),
    UNIQUE (run_id, video_id)
  );
  CREATE INDEX IF NOT EXISTS idx_creator_account_snapshot_account_time
    ON creator_account_snapshots(account_id, snapshot_at DESC);
  CREATE INDEX IF NOT EXISTS idx_creator_work_snapshot_run
    ON creator_work_snapshots(run_id, video_id);
`);

const now = () => new Date().toISOString();
const parseJson = (value, fallback = {}) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const scheduleAfter = (minutes) => new Date(Date.now() + Math.max(60, Number(minutes) || 1440) * 60000).toISOString();

const existing = db.prepare("SELECT id FROM creator_analytics_settings WHERE id=1").get();
if (!existing) {
  const time = now();
  db.prepare("INSERT INTO creator_analytics_settings (id,enabled,check_interval_minutes,created_at,updated_at) VALUES (1,0,1440,?,?)").run(time, time);
}
db.prepare("UPDATE creator_analytics_runs SET status='failed', phase='服务重启中断', error_message='服务重启时本次只读分析尚未完成，可重新执行', completed_at=? WHERE status IN ('queued','running')").run(now());

function hydrateRun(row) {
  return row ? { ...row, summary: parseJson(row.summary_json, null) } : null;
}

function getSettings() {
  const row = db.prepare("SELECT * FROM creator_analytics_settings WHERE id=1").get();
  return { ...row, enabled: Boolean(row.enabled) };
}

function updateSettings(input = {}) {
  const current = getSettings();
  const enabled = input.enabled == null ? current.enabled : input.enabled === true;
  const interval = Math.max(60, Number(input.checkIntervalMinutes || current.check_interval_minutes || 1440));
  const next = enabled
    ? (current.next_check_at && new Date(current.next_check_at).getTime() > Date.now() ? current.next_check_at : scheduleAfter(interval))
    : null;
  db.prepare("UPDATE creator_analytics_settings SET enabled=?, check_interval_minutes=?, next_check_at=?, updated_at=? WHERE id=1")
    .run(enabled ? 1 : 0, interval, next, now());
  return getSettings();
}

function createRun({ accountRole, profileId, triggerMode = "manual" }) {
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO creator_analytics_runs (id,account_role,profile_id,trigger_mode,status,phase,started_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, accountRole, profileId, triggerMode, "queued", "等待 Chrome 执行位", now());
  return getRun(id);
}

function getRun(id) {
  return hydrateRun(db.prepare("SELECT * FROM creator_analytics_runs WHERE id=?").get(id));
}

function updateRun(id, fields = {}) {
  const entries = Object.entries(fields);
  if (!entries.length) return getRun(id);
  db.prepare(`UPDATE creator_analytics_runs SET ${entries.map(([key]) => `${key}=?`).join(", ")} WHERE id=?`)
    .run(...entries.map(([, value]) => value), id);
  return getRun(id);
}

function activeRun() {
  return hydrateRun(db.prepare("SELECT * FROM creator_analytics_runs WHERE status IN ('queued','running') ORDER BY started_at DESC LIMIT 1").get());
}

function listRuns(limit = 30, profileId = "") {
  const rows = profileId
    ? db.prepare("SELECT * FROM creator_analytics_runs WHERE profile_id=? ORDER BY started_at DESC LIMIT ?").all(profileId, Math.max(1, Number(limit) || 30))
    : db.prepare("SELECT * FROM creator_analytics_runs ORDER BY started_at DESC LIMIT ?").all(Math.max(1, Number(limit) || 30));
  return rows.map(hydrateRun);
}

function saveSuccess(runId, payload, paths = {}) {
  const run = getRun(runId);
  if (!run) throw new Error("经营分析任务不存在");
  const snapshotAt = payload.snapshotAt || now();
  const account = payload.account || {};
  const works = Array.isArray(payload.works) ? payload.works : [];
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`INSERT INTO creator_account_snapshots
      (id,run_id,profile_id,account_id,douyin_id,nickname,permission_status,snapshot_at,metrics_json)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      crypto.randomUUID(), runId, run.profile_id, String(account.accountId || account.douyinId || run.profile_id),
      String(account.douyinId || ""), String(account.nickname || "未识别账号"),
      String(payload.permissionStatus || "unknown"), snapshotAt, JSON.stringify(payload.metrics || {}),
    );
    const insertWork = db.prepare(`INSERT INTO creator_work_snapshots
      (id,run_id,profile_id,account_id,video_id,title,publish_timestamp,snapshot_at,metrics_json)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    for (const work of works) {
      insertWork.run(
        crypto.randomUUID(), runId, run.profile_id, String(account.accountId || account.douyinId || run.profile_id),
        String(work.videoId), String(work.title || `作品 ${work.videoId}`), work.publishTimestamp || null,
        snapshotAt, JSON.stringify(work.metrics || {}),
      );
    }
    const summary = {
      nickname: account.nickname || "",
      douyinId: account.douyinId || "",
      permissionStatus: payload.permissionStatus || "unknown",
      workCount: works.length,
      snapshotAt,
    };
    db.prepare("UPDATE creator_analytics_runs SET status='completed', phase='经营日报已生成', summary_json=?, output_path=?, report_path=?, completed_at=? WHERE id=?")
      .run(JSON.stringify(summary), paths.outputPath || null, paths.reportPath || null, now(), runId);
    const settings = getSettings();
    db.prepare("UPDATE creator_analytics_settings SET last_checked_at=?, last_success_at=?, next_check_at=?, last_error=NULL, updated_at=? WHERE id=1")
      .run(now(), now(), settings.enabled ? scheduleAfter(settings.check_interval_minutes) : null, now());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getRun(runId);
}

function saveFailure(runId, message) {
  updateRun(runId, { status: "failed", phase: "经营分析失败", error_message: String(message || "未知错误"), completed_at: now() });
  const settings = getSettings();
  db.prepare("UPDATE creator_analytics_settings SET last_checked_at=?, next_check_at=?, last_error=?, updated_at=? WHERE id=1")
    .run(now(), settings.enabled ? scheduleAfter(Math.min(settings.check_interval_minutes, 60)) : null, String(message || "未知错误"), now());
  return getRun(runId);
}

function isDue() {
  const settings = getSettings();
  return settings.enabled && settings.next_check_at && new Date(settings.next_check_at).getTime() <= Date.now();
}

function hydrateSnapshot(row) {
  return row ? { ...row, metrics: parseJson(row.metrics_json, {}) } : null;
}

function dashboard(profileId = "") {
  const latestRow = profileId
    ? db.prepare("SELECT * FROM creator_account_snapshots WHERE profile_id=? ORDER BY snapshot_at DESC LIMIT 1").get(profileId)
    : db.prepare("SELECT * FROM creator_account_snapshots ORDER BY snapshot_at DESC LIMIT 1").get();
  const latest = hydrateSnapshot(latestRow);
  const previous = latest
    ? hydrateSnapshot(db.prepare("SELECT * FROM creator_account_snapshots WHERE account_id=? AND id<>? ORDER BY snapshot_at DESC LIMIT 1").get(latest.account_id, latest.id))
    : null;
  const works = latest
    ? db.prepare("SELECT * FROM creator_work_snapshots WHERE run_id=? ORDER BY CAST(json_extract(metrics_json,'$.viewCount') AS INTEGER) DESC, publish_timestamp DESC").all(latest.run_id)
      .map((row) => ({ ...row, metrics: parseJson(row.metrics_json, {}) }))
    : [];
  const delta = {};
  for (const key of ["following", "followers", "totalLikes"]) {
    if (latest && previous && Number.isFinite(Number(latest.metrics[key])) && Number.isFinite(Number(previous.metrics[key]))) {
      delta[key] = Number(latest.metrics[key]) - Number(previous.metrics[key]);
    }
  }
  return {
    settings: getSettings(),
    activeRun: activeRun(),
    latest,
    previous,
    delta,
    works,
    runs: listRuns(20, profileId),
  };
}

function close() {
  db.close();
}

module.exports = {
  activeRun,
  close,
  createRun,
  dashboard,
  getRun,
  getSettings,
  isDue,
  listRuns,
  saveFailure,
  saveSuccess,
  updateRun,
  updateSettings,
};
