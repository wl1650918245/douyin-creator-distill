const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { collectCreatorAnalytics } = require("../adapters/douyin/creator-analytics-crawler");
const { loadAccountProfiles, resolveAccountRole } = require("../config/account-profiles");
const { CREATOR_ANALYTICS_DIR, ensureDir, sanitizeAccountSlug } = require("../config/runtime-config");
const store = require("./creator-analytics-store");

const TICK_MS = 60000;
let timer = null;
let ticking = false;

const pad = (value) => String(value).padStart(2, "0");
function filenameStamp(date = new Date()) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
function formatNumber(value) {
  return value == null ? "-" : Number(value).toLocaleString("zh-CN");
}
function formatPercent(value) {
  return value == null ? "-" : `${(Number(value) * 100).toFixed(2)}%`;
}
function metricDelta(value) {
  if (value == null) return "未提供对比值";
  return `${Number(value) >= 0 ? "+" : ""}${formatNumber(value)}`;
}
function writeJsonAtomic(filepath, value) {
  ensureDir(path.dirname(filepath));
  const temporary = `${filepath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filepath);
}
function reportMarkdown(payload) {
  const { account, metrics, works, snapshotAt, permissionStatus } = payload;
  const byViews = [...works].sort((a, b) => Number(b.metrics.viewCount || 0) - Number(a.metrics.viewCount || 0));
  const byCompletion = [...works].filter((item) => item.metrics.completionRate != null)
    .sort((a, b) => Number(b.metrics.completionRate) - Number(a.metrics.completionRate));
  const bySubscribe = [...works].filter((item) => item.metrics.subscribeRate != null)
    .sort((a, b) => Number(b.metrics.subscribeRate) - Number(a.metrics.subscribeRate));
  const topLine = (work, metric) => work
    ? `- ${work.title}\n  - 作品 ID：${work.videoId}\n  - ${metric}`
    : "- 本次没有可比较的近期作品";
  return `---
type: creator_operations_daily
source: douyin_creator_center
douyin_id: "${account.douyinId}"
creator_name: "${String(account.nickname).replace(/"/g, '\\"')}"
snapshot_at: "${snapshotAt}"
permission_status: ${permissionStatus}
recent_work_count: ${works.length}
---

# ${account.nickname}｜账号经营快照

> 本报告来自创作者中心只读快照。数值反映采集时页面提供的数据，不等同于平台归因结论。

## 账号概览

| 指标 | 当前值 |
| --- | ---: |
| 关注 | ${formatNumber(metrics.following)} |
| 粉丝 | ${formatNumber(metrics.followers)} |
| 累计获赞 | ${formatNumber(metrics.totalLikes)} |
| 统计周期 | ${metrics.period || "未提供"} |
| 周期播放 | ${formatNumber(metrics.periodPlayCount)}（较前期 ${metricDelta(metrics.periodPlayChange)}） |
| 主页访问 | ${formatNumber(metrics.periodHomepageVisits)}（较前期 ${metricDelta(metrics.periodHomepageVisitChange)}） |
| 作品分享 | ${formatNumber(metrics.periodShares)}（较前期 ${metricDelta(metrics.periodShareChange)}） |
| 作品评论 | ${formatNumber(metrics.periodComments)}（较前期 ${metricDelta(metrics.periodCommentChange)}） |

## 近期作品信号

### 播放最高
${topLine(byViews[0], `播放 ${formatNumber(byViews[0]?.metrics.viewCount)}，完播率 ${formatPercent(byViews[0]?.metrics.completionRate)}`)}

### 完播率最高
${topLine(byCompletion[0], `完播率 ${formatPercent(byCompletion[0]?.metrics.completionRate)}，平均观看 ${byCompletion[0]?.metrics.avgViewSeconds ?? "-"} 秒`)}

### 关注转化率最高
${topLine(bySubscribe[0], `新增关注 ${formatNumber(bySubscribe[0]?.metrics.subscribeCount)}，关注转化率 ${formatPercent(bySubscribe[0]?.metrics.subscribeRate)}`)}

## 数据边界

- 本次保存 ${works.length} 条后台近期作品指标，不代表账号全部历史作品。
- 当前未采集收入、私信、评论正文或其他非经营分析所需信息。
- 只有连续快照积累后，才能判断指标趋势；单日高低不能证明稳定增长或内容因果。
`;
}

async function execute(runId) {
  const run = store.getRun(runId);
  if (!run) return;
  try {
    store.updateRun(runId, { status: "running", phase: "正在打开官方创作者中心" });
    const payload = await collectCreatorAnalytics(run.account_role, (phase) => store.updateRun(runId, { phase }));
    const stamp = filenameStamp(new Date(payload.snapshotAt));
    const accountDir = path.join(CREATOR_ANALYTICS_DIR, sanitizeAccountSlug(payload.account.douyinId || payload.account.nickname));
    const outputPath = path.join(accountDir, `${stamp}-snapshot.json`);
    const reportPath = path.join(accountDir, `${stamp}-daily.md`);
    writeJsonAtomic(outputPath, payload);
    fs.writeFileSync(reportPath, reportMarkdown(payload), "utf8");
    store.saveSuccess(runId, payload, { outputPath, reportPath });
  } catch (error) {
    store.saveFailure(runId, error.message);
  }
}

function submitRun(triggerMode = "manual") {
  const active = store.activeRun();
  if (active) return { ...active, alreadyRunning: true };
  const role = loadAccountProfiles().analyticsAccountRole || "content";
  const account = resolveAccountRole(role);
  const run = store.createRun({ accountRole: role, profileId: account.profileId, triggerMode });
  setImmediate(() => execute(run.id));
  return run;
}

function tick() {
  if (ticking || !store.isDue() || store.activeRun()) return;
  ticking = true;
  try { submitRun("schedule"); } finally { ticking = false; }
}

function startScheduler() {
  if (timer) return;
  timer = setInterval(tick, TICK_MS);
  timer.unref?.();
}

function dashboard() {
  const role = loadAccountProfiles().analyticsAccountRole || "content";
  const account = resolveAccountRole(role);
  return {
    ...store.dashboard(account.profileId),
    configuredAccount: {
      role,
      roleLabel: account.roleLabel,
      profileId: account.profileId,
    },
  };
}

function openFolder() {
  const current = dashboard();
  const reportPath = current.latest ? store.getRun(current.latest.run_id)?.report_path : "";
  const target = reportPath ? path.dirname(reportPath) : CREATOR_ANALYTICS_DIR;
  const folder = target && fs.existsSync(target) ? target : CREATOR_ANALYTICS_DIR;
  ensureDir(folder);
  const explorer = spawn("explorer.exe", [folder], { detached: true, stdio: "ignore", windowsHide: false });
  explorer.unref();
  return folder;
}

module.exports = {
  dashboard,
  getRun: store.getRun,
  getSettings: store.getSettings,
  openFolder,
  startScheduler,
  submitRun,
  updateSettings: store.updateSettings,
};
