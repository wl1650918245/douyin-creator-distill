const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const {
  addRun,
  appendLog,
  completeSubscriptionCheck,
  createTaskAttempt,
  createTask,
  failSubscriptionCheck,
  getFavoritesDirectoryCache,
  getTask,
  listTaskAttempts,
  listTasks,
  saveFavoritesDirectoryCache,
  updateTask,
  updateTaskAttempt,
  updateTaskProgress,
  upsertSubscriptionFromTask,
} = require("./task-store");
const { auditJson } = require("./json-audit");
const { LOOP_STEPS, classifyCrawlFailure, mergeCrawlArtifacts } = require("./crawl-loop-policy");
const { resolveAccountRole } = require("../config/account-profiles");

let active = false;
const queue = [];
const RETRY_DELAYS_MS = [8000, 15000];

function submit(source, options = {}) {
  const sourceMode = options.sourceMode || "profile";
  const accountRole = options.accountRole || (sourceMode === "favorites" ? "favorites" : "content");
  const profile = resolveAccountRole(accountRole);
  const collectionIds = [...new Set((options.collectionIds || []).map(String).filter(Boolean))];
  const kind = sourceMode === "favorites"
    ? (collectionIds.length ? "favorites-crawl" : "favorites-discovery")
    : "profile-crawl";
  const id = crypto.randomUUID();
  const taskOptions = {
    collectionIds,
    discoveryTaskId: options.discoveryTaskId || null,
    kind,
    subscriptionId: options.subscriptionId || null,
    triggerMode: options.triggerMode || "manual",
    loop: {
      version: 1,
      resumeEnabled: true,
      state: "queued",
      currentAttempt: 0,
      maxAttempts: sourceMode === "profile" ? 3 : 2,
    },
  };
  createTask(id, source, { sourceMode, accountRole, profileId: profile.profileId, options: taskOptions });
  queue.push({ id, source, sourceMode, accountRole, profileId: profile.profileId, profilePath: profile.profilePath, ...taskOptions });
  pump();
  return id;
}

function submitFavoritesSelection(discoveryTaskId, collectionIds) {
  const discovery = getTask(discoveryTaskId);
  const selected = [...new Set((Array.isArray(collectionIds) ? collectionIds : []).map(String).filter(Boolean))];
  if (!selected.length) throw new Error("至少选择一个收藏夹，或选择全部收藏夹");
  if (!discoveryTaskId) {
    const profile = resolveAccountRole("favorites");
    const cache = getFavoritesDirectoryCache(profile.profileId, 1440);
    if (!cache) throw new Error("收藏夹目录缓存不存在或已过期，请先刷新收藏夹目录");
    const available = new Set(cache.collections.map((collection) => String(collection.id)));
    if (selected.some((id) => id !== "all" && !available.has(id))) throw new Error("所选收藏夹不在当前目录缓存中，请刷新后重试");
    return submit("我的收藏夹", { sourceMode: "favorites", accountRole: "favorites", collectionIds: selected });
  }
  if (!discovery || discovery.source_mode !== "favorites" || discovery.options?.kind !== "favorites-discovery") {
    throw new Error("收藏夹目录发现任务不存在");
  }
  if (discovery.status !== "waiting_for_user" || !discovery.output_path || !fs.existsSync(discovery.output_path)) {
    throw new Error("收藏夹目录尚未准备好，请等待目录发现任务完成");
  }
  return submit(discovery.source, { sourceMode: "favorites", accountRole: "favorites", collectionIds: selected, discoveryTaskId });
}

function pump() {
  if (active || !queue.length) return;
  active = true;
  const job = queue.shift();
  runGoal(job).finally(() => { active = false; pump(); });
}

function saveLoopState(taskId, patch) {
  const task = getTask(taskId);
  const options = { ...(task?.options || {}) };
  options.loop = { ...(options.loop || {}), ...patch };
  return updateTask(taskId, { options_json: JSON.stringify(options) });
}

function loopStepsFor(job) {
  return job.sourceMode === "profile" ? LOOP_STEPS : LOOP_STEPS.slice(0, 2);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function persistAudit(taskId, source, outputPath, recordRun = false) {
  const audit = auditJson(outputPath);
  const status = audit.status === "passed" ? "waiting_for_user" : "partial";
  const task = getTask(taskId);
  const creatorName = task?.source_mode === "favorites" ? "我的收藏夹" : audit.data.works.find((work) => work.authorNickname)?.authorNickname || task?.creator_name || "";
  const missingFields = Object.entries(audit.summary.missing).filter(([, count]) => count > 0).map(([field, count]) => `${field} 缺失 ${count} 条`);
  if (audit.summary.foreignAuthorCount) missingFields.push(`异作者作品 ${audit.summary.foreignAuthorCount} 条`);
  const warningFields = Object.entries(audit.summary.warnings || {}).map(([field, count]) => `${field} 缺失 ${count} 条`);
  const warningSuffix = audit.summary.warningCount ? `（${audit.summary.warningCount} 条警告）` : "";
  const attempts = listTaskAttempts(taskId);
  const loop = task?.options?.loop || {};
  const summary = {
    ...audit.summary,
    loop: {
      state: audit.status === "passed" ? "completed" : "exhausted_review",
      currentAttempt: attempts.length,
      maxAttempts: loop.maxAttempts || attempts.length,
      attempts: attempts.map((attempt) => ({
        attempt: attempt.attempt_no,
        strategy: attempt.strategy,
        status: attempt.status,
        errorClass: attempt.error_class,
        auditStatus: attempt.audit_status,
      })),
    },
  };
  updateTask(taskId, { status, phase: audit.status === "passed" ? `JSON 审核通过${warningSuffix}` : "JSON 部分通过", output_path: outputPath, audit_status: audit.status, creator_name: creatorName, error_message: null, summary_json: JSON.stringify(summary) });
  saveLoopState(taskId, { state: audit.status === "passed" ? "completed" : "exhausted_review", currentAttempt: attempts.length });
  updateTaskProgress(taskId, {
    stage: "completed",
    label: audit.status === "passed" ? `JSON 审核通过${warningSuffix}` : "JSON 待复核",
    discovered: audit.summary.totalCount,
    expectedTotal: audit.summary.pageTotal || null,
    detail: audit.status === "passed"
      ? `${audit.summary.totalCount} 条唯一作品${warningFields.length ? `，${warningFields.join("、")}，不阻断后续处理` : "，必填字段检查完成"}`
      : `主页计数 ${audit.summary.pageTotal || "未知"}，抓到 ${audit.summary.totalCount}；${missingFields.join("、") || "字段需复核"}`,
  });
  if (recordRun) addRun({ id: crypto.randomUUID(), taskId, source, outputPath, auditStatus: audit.status, totalCount: audit.summary.totalCount });
  if (status === "waiting_for_user") {
    upsertSubscriptionFromTask(taskId);
    if (task?.options?.subscriptionId) completeSubscriptionCheck(task.options.subscriptionId, outputPath);
  } else if (task?.options?.subscriptionId) {
    failSubscriptionCheck(task.options.subscriptionId, "JSON 审核待复核，未更新增量基线");
  }
  return getTask(taskId);
}

function persistSourceContext(outputPath, job) {
  const data = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
  data.sourceContext = { sourceMode: job.sourceMode, accountRole: job.accountRole, profileId: job.profileId };
  fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), "utf8");
}

function persistFavoritesDiscovery(taskId, source, outputPath) {
  const data = JSON.parse(fs.readFileSync(outputPath, "utf8").replace(/^\uFEFF/, ""));
  const collections = Array.isArray(data.collections) ? data.collections : [];
  const task = getTask(taskId);
  saveFavoritesDirectoryCache(task?.profile_id || data.profileId, collections, outputPath);
  updateTask(taskId, {
    status: "waiting_for_user",
    phase: "收藏夹目录已获取，等待选择",
    output_path: outputPath,
    audit_status: "pending_selection",
    creator_name: "我的收藏夹",
    error_message: null,
    summary_json: JSON.stringify({ totalCount: 0, collectionCount: collections.length, collections, status: "pending_selection" }),
  });
  updateTaskProgress(taskId, { stage: "collections_ready", label: "收藏夹目录已获取，等待选择", discovered: collections.length, expectedTotal: collections.length, detail: `已发现 ${collections.length} 个收藏夹；请选择一个或多个后再抓取作品` });
  return getTask(taskId);
}

function reaudit(taskId) {
  const task = getTask(taskId);
  if (!task) throw new Error("任务不存在");
  if (!task.output_path || !fs.existsSync(task.output_path)) throw new Error("该任务没有可重新审核的 JSON");
  if (task.options?.kind === "favorites-discovery") throw new Error("收藏夹目录发现任务无需 JSON 审核，请选择收藏夹后继续抓取");
  appendLog(taskId, "按当前审核规则重新检查现有 JSON，不重新抓取。\n");
  return persistAudit(taskId, task.source, task.output_path);
}

function runCrawlerAttempt(job, step, attemptNo) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const attemptId = crypto.randomUUID();
    createTaskAttempt({ id: attemptId, taskId: job.id, attemptNo, strategy: step.strategy, metadata: { label: step.label } });
    saveLoopState(job.id, { state: "executing", currentAttempt: attemptNo, currentStrategy: step.strategy });
    updateTask(job.id, { status: "running", phase: step.label, error_message: null });
    updateTaskProgress(job.id, {
      stage: step.strategy,
      label: step.label,
      attempt: attemptNo,
      maxAttempts: loopStepsFor(job).length,
      detail: step.strategy === "api_supplement"
        ? "Chrome 两轮审核仍未通过，正在使用内部 API 补充缺失目录数据"
        : `${step.label}，完成后将自动审核 JSON`,
    });
    appendLog(job.id, `\n===== 尝试 ${attemptNo}/${loopStepsFor(job).length}：${step.label} =====`);
    const script = path.join(__dirname, "..", "adapters", "douyin", job.kind.startsWith("favorites") ? "favorites-crawler.js" : "profile-crawler.js");
    const args = [script];
    if (job.kind.startsWith("favorites")) {
      if (job.kind === "favorites-discovery") args.push("--list-only");
      else args.push(`--collection-ids=${job.collectionIds.join(",")}`);
    } else {
      args.push(job.source, "--limit=0", "--include-images", "--dry");
      if (step.strategy === "api_supplement") args.push("--api-supplement");
      else args.push("--no-direct-api", "--no-search-api");
    }
    args.push(`--profile=${job.profilePath}`);
    const child = spawn(process.execPath, args, { windowsHide: true, env: process.env });
    let output = "";
    let lineBuffer = "";
    const handleLine = (line) => {
      if (!line) return;
      if (line.startsWith("@@PROGRESS@@")) {
        try { updateTaskProgress(job.id, JSON.parse(line.slice("@@PROGRESS@@".length))); } catch { appendLog(job.id, "无法解析结构化进度事件"); }
        return;
      }
      appendLog(job.id, line);
    };
    const onData = (chunk) => {
      const text = chunk.toString(); output += text; lineBuffer += text;
      const lines = lineBuffer.split(/\r?\n/); lineBuffer = lines.pop(); lines.forEach(handleLine);
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("error", (error) => {
      const failure = error.message || "无法启动抓取进程";
      updateTaskAttempt(attemptId, { status: "failed", error_class: classifyCrawlFailure(failure).code, error_message: failure, completed_at: new Date().toISOString() });
      finish({ ok: false, attemptId, output, error: failure });
    });
    child.on("close", (code) => {
      if (settled) return;
      handleLine(lineBuffer);
      const collectionMatch = output.match(/收藏夹目录已导出:\s*(.+\.json)/);
      const exportMatch = output.match(/自媒体分析数据已导出:\s*(.+\.json)/);
      const outputPath = (collectionMatch || exportMatch)?.[1]?.trim() || "";
      if (!outputPath || !fs.existsSync(outputPath)) {
        const failure = output.match(/(?:收藏夹抓取失败|错误):\s*(.+)/)?.[1] || `crawler exited with ${code}`;
        const classified = classifyCrawlFailure(`${failure}\n${output}`);
        updateTaskAttempt(attemptId, { status: "failed", error_class: classified.code, error_message: failure.trim(), completed_at: new Date().toISOString() });
        return finish({ ok: false, attemptId, output, error: failure.trim(), classified });
      }
      try {
        persistSourceContext(outputPath, job);
        if (job.kind === "favorites-discovery") {
          updateTaskAttempt(attemptId, { status: "completed", output_path: outputPath, audit_status: "pending_selection", completed_at: new Date().toISOString() });
          return finish({ ok: true, attemptId, outputPath, discovery: true });
        }
        const audit = auditJson(outputPath);
        updateTaskAttempt(attemptId, { status: audit.status === "passed" ? "completed" : "partial", output_path: outputPath, audit_status: audit.status, error_class: audit.status === "passed" ? null : "incomplete_directory", completed_at: new Date().toISOString(), metadata_json: JSON.stringify(audit.summary) });
        return finish({ ok: true, attemptId, outputPath, audit });
      } catch (error) {
        const classified = classifyCrawlFailure(error.message);
        updateTaskAttempt(attemptId, { status: "failed", error_class: classified.code, error_message: error.message, completed_at: new Date().toISOString() });
        return finish({ ok: false, attemptId, output, error: error.message, classified });
      }
    });
  });
}

async function runGoal(job) {
  const steps = loopStepsFor(job);
  const priorAttempts = listTaskAttempts(job.id);
  const artifacts = priorAttempts
    .filter((attempt) => attempt.output_path && fs.existsSync(attempt.output_path))
    .map((attempt) => ({ attempt: attempt.attempt_no, strategy: attempt.strategy, outputPath: attempt.output_path, auditStatus: attempt.audit_status }));
  const startIndex = Math.min(priorAttempts.length, steps.length);

  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index];
    const attemptNo = index + 1;
    const result = await runCrawlerAttempt(job, step, attemptNo);

    if (result.discovery) {
      persistFavoritesDiscovery(job.id, job.source, result.outputPath);
      saveLoopState(job.id, { state: "completed", currentAttempt: attemptNo });
      return;
    }

    if (result.ok) {
      artifacts.push({ attempt: attemptNo, strategy: step.strategy, outputPath: result.outputPath, auditStatus: result.audit.status });
      const mergedPath = mergeCrawlArtifacts(artifacts, { taskId: job.id, source: job.source });
      persistSourceContext(mergedPath, job);
      const mergedAudit = auditJson(mergedPath);
      appendLog(job.id, `${step.label}完成：本轮 ${result.audit.summary.totalCount} 条，合并后 ${mergedAudit.summary.totalCount} 条，审核 ${mergedAudit.status}`);
      if (mergedAudit.status === "passed") {
        persistAudit(job.id, job.source, mergedPath, true);
        return;
      }
      updateTask(job.id, { output_path: mergedPath, audit_status: "partial", summary_json: JSON.stringify({ ...mergedAudit.summary, loop: { state: "retrying", currentAttempt: attemptNo, maxAttempts: steps.length } }) });
      updateTaskProgress(job.id, {
        stage: "audit_incomplete",
        label: `${step.label}审核未通过`,
        attempt: attemptNo,
        maxAttempts: steps.length,
        discovered: mergedAudit.summary.totalCount,
        expectedTotal: mergedAudit.summary.pageTotal,
        detail: `已保留并合并现有 JSON；将执行下一条恢复策略`,
      });
    } else {
      const classified = result.classified || classifyCrawlFailure(`${result.error}\n${result.output}`);
      appendLog(job.id, `${step.label}失败 [${classified.code}]：${result.error}`);
      if (classified.requiresUser) {
        saveLoopState(job.id, { state: "waiting_for_action", currentAttempt: attemptNo, errorClass: classified.code });
        updateTask(job.id, { status: "waiting_for_action", phase: "等待人工处理", error_message: result.error });
        updateTaskProgress(job.id, { stage: "waiting_for_action", label: "等待人工处理", attempt: attemptNo, maxAttempts: steps.length, detail: result.error });
        if (job.subscriptionId) failSubscriptionCheck(job.subscriptionId, result.error);
        return;
      }
    }

    if (index < steps.length - 1) {
      const delay = RETRY_DELAYS_MS[Math.min(index, RETRY_DELAYS_MS.length - 1)];
      saveLoopState(job.id, { state: "retry_wait", currentAttempt: attemptNo, nextStrategy: steps[index + 1].strategy });
      updateTaskProgress(job.id, {
        stage: "retry_wait",
        label: `准备执行${steps[index + 1].label}`,
        attempt: attemptNo,
        maxAttempts: steps.length,
        detail: `等待 ${Math.round(delay / 1000)} 秒后继续；不会丢弃已抓取数据`,
      });
      await wait(delay);
    }
  }

  if (artifacts.length) {
    const mergedPath = mergeCrawlArtifacts(artifacts, { taskId: job.id, source: job.source });
    persistSourceContext(mergedPath, job);
    persistAudit(job.id, job.source, mergedPath, true);
    return;
  }

  const finalAttempt = listTaskAttempts(job.id).at(-1);
  const failure = finalAttempt?.error_message || "所有安全恢复策略均未生成可审核目录";
  saveLoopState(job.id, { state: "exhausted_failed", currentAttempt: steps.length });
  updateTask(job.id, { status: "failed", phase: "安全恢复策略已用尽", error_message: failure });
  updateTaskProgress(job.id, { stage: "failed", label: "任务失败", detail: failure });
  if (job.subscriptionId) failSubscriptionCheck(job.subscriptionId, failure);
}

function recoverInterruptedGoals() {
  const recoverable = listTasks().filter((task) =>
    task.status === "interrupted_recoverable"
    && task.options?.loop?.version === 1
    && task.options.loop.resumeEnabled
    && ["profile-crawl", "favorites-crawl", "favorites-discovery"].includes(task.options.kind),
  );
  for (const task of recoverable) {
    queue.push({
      id: task.id,
      source: task.source,
      sourceMode: task.source_mode,
      accountRole: task.account_role,
      profileId: task.profile_id,
      profilePath: resolveAccountRole(task.account_role).profilePath,
      ...task.options,
    });
    appendLog(task.id, "检测到服务重启，正在从上一次已持久化尝试继续。");
  }
  if (recoverable.length) pump();
}

recoverInterruptedGoals();

module.exports = { reaudit, submit, submitFavoritesSelection };
