const sourceInput = document.querySelector("#source-input");
const fetchDirectory = document.querySelector("#fetch-directory");
const sourceStatus = document.querySelector("#source-status");
const sourceProgress = document.querySelector("#source-progress");
let lastSourceProgressMarkup = "";
const worksBody = document.querySelector("#works-body");
const selectPage = document.querySelector("#select-page");
const pageSize = document.querySelector("#page-size");
const previousPage = document.querySelector("#previous-page");
const nextPage = document.querySelector("#next-page");
const pageButtons = document.querySelector("#page-buttons");
const pageSummary = document.querySelector("#page-summary");
const visibleCount = document.querySelector("#visible-count");
const selectionCount = document.querySelector("#selection-count");
const selectionNote = document.querySelector("#selection-note");
const selectionBar = document.querySelector("#selection-bar");
const screenSelected = document.querySelector("#screen-selected");
const analyzeSelected = document.querySelector("#analyze-selected");
const breakdownStatus = document.querySelector("#breakdown-status");
const breakdownPath = document.querySelector("#breakdown-path");
const breakdownReport = document.querySelector("#breakdown-report");
const breakdownProgress = document.querySelector("#breakdown-progress");
const breakdownHistoryStatus = document.querySelector("#breakdown-history-status");
const breakdownHistoryList = document.querySelector("#breakdown-history-list");
const openBreakdownFolder = document.querySelector("#open-breakdown-folder");
const useBreakdownForTopics = document.querySelector("#use-breakdown-for-topics");
const transcribeSelected = document.querySelector("#transcribe-selected");
const transcriptionProviderDialog = document.querySelector("#transcription-provider-dialog");
const favoritesCollectionsDialog = document.querySelector("#favorites-collections-dialog");
const favoritesCollectionsForm = document.querySelector("#favorites-collections-form");
const favoritesCollectionsList = document.querySelector("#favorites-collections-list");
const favoritesCollectionsSummary = document.querySelector("#favorites-collections-summary");
const favoritesSelectAll = document.querySelector("#favorites-select-all");
const favoritesConfirm = document.querySelector("#favorites-confirm");
const favoritesRefresh = document.querySelector("#favorites-refresh");
const distillSelected = document.querySelector("#distill-selected");
const distillationPoolStatus = document.querySelector("#distillation-pool-status");
const distillationPoolMeta = document.querySelector("#distillation-pool-meta");
const distillationPoolList = document.querySelector("#distillation-pool-list");
const topicSourceList = document.querySelector("#topic-source-list");
const topicBatchStatus = document.querySelector("#topic-batch-status");
const topicPositioning = document.querySelector("#topic-positioning");
const topicCardList = document.querySelector("#topic-card-list");
const topicBatchHistory = document.querySelector("#topic-batch-history");
const topicGenerationProgress = document.querySelector("#topic-generation-progress");
const generateTopics = document.querySelector("#generate-topics");
const openTopicFolder = document.querySelector("#open-topic-folder");
const topicComparisonModeInput = document.querySelector("#topic-comparison-mode");
const agentCreatorList = document.querySelector("#agent-creator-list");
const agentReadinessCard = document.querySelector("#agent-readiness-card");
const generateCreatorAgent = document.querySelector("#generate-creator-agent");
const openAgentFolder = document.querySelector("#open-agent-folder");
const agentGenerationProgress = document.querySelector("#agent-generation-progress");
const creatorAgentStatus = document.querySelector("#creator-agent-status");
const creatorAgentProfile = document.querySelector("#creator-agent-profile");
const draftReviewInput = document.querySelector("#draft-review-input");
const reviewDraft = document.querySelector("#review-draft");
const draftReviewOutput = document.querySelector("#draft-review-output");
const draftReviewState = document.querySelector("#draft-review-state");
const selectFiltered = document.querySelector("#select-filtered");
const creatorName = document.querySelector("#creator-name");
const creatorMeta = document.querySelector("#creator-meta");
const creatorAvatar = document.querySelector("#creator-avatar");
const totalCount = document.querySelector("#total-count");
const videoCount = document.querySelector("#video-count");
const imageCount = document.querySelector("#image-count");
const auditStatus = document.querySelector("#audit-status");
const taskRuntimeStatus = document.querySelector("#task-runtime-status");
const directoryModeBanner = document.querySelector("#directory-mode-banner");
const appToast = document.querySelector("#app-toast");
const mainPanel = document.querySelector(".main-panel");
const contentPanel = document.querySelector(".content-panel");
const workspaceGrid = document.querySelector(".workspace-grid");
const workspaceResizer = document.querySelector("#workspace-resizer");
const viewTitle = document.querySelector("#view-title");
const typeFilter = document.querySelector("#type-filter");
const transcriptFilter = document.querySelector("#transcript-filter");
const dateFilter = document.querySelector("#date-filter");
const minLikes = document.querySelector("#min-likes");
const minInteractions = document.querySelector("#min-interactions");
const workbenchView = document.querySelector("#workbench-view");
const viewPanels = document.querySelectorAll(".view-panel");
const viewNames = { workbench: "内容工作台", tasks: "任务中心", archive: "关注与更新", breakdown: "爆款拆解", topics: "选题顾问", agent: "博主智能体", settings: "设置中心", storage: "知识资产目录" };
const activeViewKey = "self-media-workbench.active-view";
const storageRoots = { obsidian: "正在读取本地运行配置...", local: "请选择本地文件夹" };
let storageMode = "obsidian";

let works = [];

let currentPage = 1;
let currentPageSize = 50;
let sortKey = "date";
let selectedIds = new Set();
let hasHydratedWorks = false;
let currentCrawlTaskId = "";
let currentCrawlStatus = "";
let activeSourceTaskId = "";
let lastTranscriptSignature = "";
const openTaskLogs = new Set();
let lastTaskRenderSignature = "";
let taskStatusFilter = "";
let taskTypeFilter = "";
let activeBreakdownPoll = 0;
let activeBreakdownReportId = "";
let lastViralReportSignature = "";
let viralReportsById = new Map();
let latestTasksById = new Map();
let selectedCreatorSource = "";
let archiveCreators = [];
let lastCreatorArchiveSignature = "";
let toastTimer = null;
let lastAccountProfileSignature = "";
let lastAccountReadyState = null;
let activeFavoritesDiscoveryTaskId = "";
let selectedTopicReportIds = new Set();
let topicReportsById = new Map();
let topicComparisonMode = false;
let activeTopicBatchId = "";
let lastTopicSignature = "";
let selectedAgentCreator = "";
let activeCreatorAgentId = "";
let activeCreatorAgentStatus = "";
let lastAgentSignature = "";

const creatorWidthKey = "douyin-creator-distill.creator-width";
const legacyCreatorWidthKey = "ai-viral-analysis.creator-width";
const creatorWidthBounds = { min: 196, max: 380, default: 210 };
function setCreatorWidth(value, persist = true) {
  const width = Math.max(creatorWidthBounds.min, Math.min(creatorWidthBounds.max, Math.round(value)));
  workspaceGrid.style.setProperty("--creator-width", `${width}px`);
  workspaceResizer.setAttribute("aria-valuenow", String(width));
  if (persist) localStorage.setItem(creatorWidthKey, String(width));
}
const savedCreatorWidth = Number(localStorage.getItem(creatorWidthKey) || localStorage.getItem(legacyCreatorWidthKey));
setCreatorWidth(Number.isFinite(savedCreatorWidth) && savedCreatorWidth > 0 ? savedCreatorWidth : creatorWidthBounds.default, false);
workspaceResizer.addEventListener("pointerdown", (event) => {
  if (window.matchMedia("(max-width: 700px)").matches) return;
  const startX = event.clientX;
  const startWidth = workspaceGrid.getBoundingClientRect().width
    ? Number.parseFloat(getComputedStyle(workspaceGrid).getPropertyValue("--creator-width")) || creatorWidthBounds.default
    : creatorWidthBounds.default;
  workspaceGrid.classList.add("is-resizing");
  workspaceResizer.setPointerCapture(event.pointerId);
  const move = (moveEvent) => setCreatorWidth(startWidth + moveEvent.clientX - startX);
  const end = () => {
    workspaceGrid.classList.remove("is-resizing");
    workspaceResizer.removeEventListener("pointermove", move);
    workspaceResizer.removeEventListener("pointerup", end);
    workspaceResizer.removeEventListener("pointercancel", end);
  };
  workspaceResizer.addEventListener("pointermove", move);
  workspaceResizer.addEventListener("pointerup", end);
  workspaceResizer.addEventListener("pointercancel", end);
});
workspaceResizer.addEventListener("keydown", (event) => {
  const current = Number.parseFloat(getComputedStyle(workspaceGrid).getPropertyValue("--creator-width")) || creatorWidthBounds.default;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    setCreatorWidth(current + (event.key === "ArrowLeft" ? -12 : 12));
  }
});

function formatNumber(value) { return Number(value).toLocaleString("zh-CN"); }
function stripAssetFrontmatter(value) { return String(value || "").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n+/, "").trim(); }
function showToast(message, tone = "default") {
  window.clearTimeout(toastTimer);
  appToast.textContent = message;
  appToast.className = `app-toast is-visible is-${tone}`;
  appToast.hidden = false;
  toastTimer = window.setTimeout(() => {
    appToast.classList.remove("is-visible");
    window.setTimeout(() => { appToast.hidden = true; }, 180);
  }, 5000);
}
async function readApiPayload(response, fallbackMessage) {
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text || fallbackMessage }; }
  if (!response.ok && response.status === 404 && !payload.error?.trim?.()) payload.error = "本地后端版本过旧，缺少当前功能接口。请重启自媒体工作台后重试。";
  if (!response.ok && response.status === 404 && payload.error === "Not found") payload.error = "本地后端版本过旧，缺少当前功能接口。请重启自媒体工作台后重试。";
  return payload;
}
function activeWorks() {
  const maxAge = Number(dateFilter.value);
  const latestDate = new Date(Math.max(...works.map((work) => new Date(work.date))));
  return works.filter((work) => {
    const withinDateRange = !maxAge || ((latestDate - new Date(work.date)) / 86400000) <= maxAge;
    return (typeFilter.value === "all" || work.contentType === typeFilter.value)
      && (transcriptFilter.value === "all" || work.transcript === transcriptFilter.value)
      && withinDateRange
      && work.likes >= Number(minLikes.value || 0)
      && work.interactions >= Number(minInteractions.value || 0);
  });
}
function sortedWorks() { return [...activeWorks()].sort((a, b) => String(b[sortKey]).localeCompare(String(a[sortKey]), "zh-CN", { numeric: true })); }
function pageCount() { return Math.max(1, Math.ceil(sortedWorks().length / currentPageSize)); }
function currentWorks() { const start = (currentPage - 1) * currentPageSize; return sortedWorks().slice(start, start + currentPageSize); }
function workRow(work) {
  const isImage = work.contentType === "图文";
  const isTranscribing = ["转写中", "排队中"].includes(work.transcript);
  const url = /^https?:\/\//.test(work.douyinUrl || "") ? work.douyinUrl : "#";
  const transcriptClass = work.transcript === "已转写" ? "is-ready" : ["转写失败", "部分转写"].includes(work.transcript) ? "is-failed" : "";
  const provider = work.transcriptProviderLabel ? `<small class="provider-chip">${escapeHtml(work.transcriptProviderLabel)}</small>` : "";
  return `<tr class="${isTranscribing ? "is-transcribing" : ""}" data-id="${escapeHtml(work.id)}"><td class="check-cell"><input class="work-check" type="checkbox" aria-label="选择 ${escapeHtml(work.title)}" ${selectedIds.has(work.id) ? "checked" : ""} /></td><td><div class="work-title ${isTranscribing ? "is-transcribing" : ""}"><span class="cover ${isImage ? "is-image" : ""}">${isImage ? "图" : "播"}</span><strong>${escapeHtml(work.title)}</strong>${work.titleMissing ? '<i class="metadata-warning">标题缺失</i>' : ""}${isTranscribing ? '<i class="transcribing-indicator">转写中</i>' : ""}</div></td><td>${escapeHtml(work.date)}</td><td><span class="type-tag ${isImage ? "is-image" : ""}">${escapeHtml(work.contentType)}</span></td><td>${formatNumber(work.likes)}</td><td>${formatNumber(work.comments)}</td><td>${formatNumber(work.collects)}</td><td>${formatNumber(work.shares)}</td><td><b class="interaction-value">${formatNumber(work.interactions)}</b></td><td><span class="transcript ${transcriptClass}">${escapeHtml(work.transcript)}</span>${provider}</td><td class="description-cell" title="${escapeHtml(work.description)}">${escapeHtml(work.description)}</td><td><a class="douyin-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">查看抖音</a></td></tr>`;
}
function renderRows() {
  const pageWorks = currentWorks();
  worksBody.innerHTML = pageWorks.map(workRow).join("") || `<tr><td class="empty-state" colspan="12">没有符合当前筛选条件的作品。请调整筛选条件后重试。</td></tr>`;
  document.querySelectorAll(".work-check").forEach((check) => check.addEventListener("change", (event) => {
    const id = event.target.closest("tr").dataset.id;
    if (event.target.checked) selectedIds.add(id); else selectedIds.delete(id);
    render();
  }));
  selectPage.checked = pageWorks.length > 0 && pageWorks.every((work) => selectedIds.has(work.id));
  selectPage.indeterminate = pageWorks.some((work) => selectedIds.has(work.id)) && !selectPage.checked;
}
function renderPagination() {
  const totalPages = pageCount();
  if (currentPage > totalPages) currentPage = totalPages;
  pageSummary.textContent = `第 ${currentPage} 页，共 ${totalPages} 页`;
  previousPage.disabled = currentPage === 1;
  nextPage.disabled = currentPage === totalPages;
  pageButtons.innerHTML = Array.from({ length: totalPages }, (_, index) => `<button class="page-button ${index + 1 === currentPage ? "is-active" : ""}" type="button" data-page="${index + 1}">${index + 1}</button>`).join("");
  document.querySelectorAll(".page-button").forEach((button) => button.addEventListener("click", () => { currentPage = Number(button.dataset.page); render(); }));
}
function renderSelection() {
  const count = selectedIds.size;
  const filteredCount = activeWorks().length;
  const selectedWorks = works.filter((work) => selectedIds.has(work.id));
  const transcribedCount = selectedWorks.filter((work) => work.transcript === "已转写").length;
  const pendingTranscripts = selectedWorks.filter((work) => ["queued", "running"].includes(work.transcriptStatus));
  const failedTranscripts = selectedWorks.filter((work) => ["failed", "partial"].includes(work.transcriptStatus));
  const allSelectedTranscribed = count > 0 && transcribedCount === count;
  const reviewOnly = currentCrawlStatus === "partial";
  visibleCount.textContent = `${filteredCount} / ${works.length} 条`;
  selectionCount.textContent = count ? `已选 ${count} 条作品` : "未选择作品";
  selectionNote.textContent = reviewOnly
    ? "此目录待复核：可查看和筛选，但不能转写、拆解或蒸馏。请先核对审核差异，必要时重新抓取复核。"
    : !count
    ? `当前筛选结果 ${filteredCount} 条，请勾选要处理的作品。深度拆解和知识蒸馏依赖完整转写文本。`
    : pendingTranscripts.length
      ? `文本提取服务正在转写 ${pendingTranscripts.length} 条，请等待结果；完成后本页会自动更新。`
      : failedTranscripts.length
        ? `文本提取服务转写失败 ${failedTranscripts.length} 条：${scrubProviderName(failedTranscripts[0].transcriptError || "请检查网络或系统代理后重新提交。")}`
    : allSelectedTranscribed && count > 20
      ? `已选 ${count} 条且均已转写；单份爆款拆解报告最多 20 条，请减少选择。知识蒸馏素材池不受此限制。`
    : allSelectedTranscribed
      ? `已选内容均已转写，可进行深度爆款拆解或知识蒸馏。`
      : `已从 ${filteredCount} 条筛选结果中选择 ${count} 条；其中 ${count - transcribedCount} 条待转写，完成后可深度拆解和知识蒸馏。`;
  selectionBar.classList.toggle("is-transcribing", pendingTranscripts.length > 0);
  selectionBar.classList.toggle("is-error", failedTranscripts.length > 0);
  screenSelected.disabled = reviewOnly || count === 0;
  analyzeSelected.disabled = reviewOnly || !allSelectedTranscribed || count > 20;
  distillSelected.disabled = reviewOnly || !allSelectedTranscribed;
  transcribeSelected.disabled = reviewOnly || count === 0;
  screenSelected.textContent = count ? `爆款初筛 ${count} 条` : "爆款初筛";
  analyzeSelected.textContent = count ? `深度拆解 ${count} 条` : "深度爆款拆解";
  transcribeSelected.textContent = count ? `转写所选 ${count} 条` : "转写所选";
  distillSelected.textContent = count ? `加入蒸馏素材池 ${count} 条` : "加入蒸馏素材池";
  selectFiltered.textContent = filteredCount && activeWorks().every((work) => selectedIds.has(work.id)) ? "已全选筛选结果" : `全选筛选结果 ${filteredCount} 条`;
}
function render() { renderRows(); renderPagination(); renderSelection(); }
function refreshForFilter() { selectedIds.clear(); currentPage = 1; render(); }
function refreshForView() { currentPage = 1; render(); }

const legacyProviderName = `Get${"\u7b14\u8bb0"}`;
function scrubProviderName(value) {
  return String(value ?? "")
    .replace(new RegExp(`${legacyProviderName}|${"Get"} Notes`, "g"), "文本提取服务")
    .replace(/connect ETIMEDOUT\s+[^\s]+/gi, "分析模型连接超时，请检查当前网络或系统代理后重试")
    .replace(/connect ECONNREFUSED\s+[^\s]+/gi, "分析模型连接被拒绝，请检查网络代理和模型服务状态后重试");
}
function isGetNotesTask(task) { return ["getnotes", "whisper"].includes(task?.summary?.provider) || String(task?.source || "").startsWith(`${legacyProviderName}转写 / `) || String(task?.source || "").startsWith("文本提取 / ") || String(task?.source || "").startsWith("Whisper转写 / "); }
function isViralTask(task) { return task?.summary?.provider === "viral-breakdown" || String(task?.source || "").startsWith("爆款拆解 / "); }
function isContentIntelligenceTask(task) { return ["topic-advisor", "creator-agent", "creator-agent-review"].includes(task?.summary?.provider); }
function isAnalysisTask(task) { return isViralTask(task) || isContentIntelligenceTask(task); }
function isDirectoryTask(task) { return !isGetNotesTask(task) && !isAnalysisTask(task); }
function taskKind(task) {
  const provider = task?.summary?.provider;
  if (provider === "topic-advisor") return "选题顾问";
  if (provider === "creator-agent") return "博主智能体";
  if (provider === "creator-agent-review") return "智能体审稿";
  return isViralTask(task) ? "爆款拆解" : provider === "whisper" ? "本地 Whisper" : isGetNotesTask(task) ? "文本提取" : isFavoritesDiscoveryTask(task) ? "收藏夹目录" : "目录抓取";
}
function taskFailureDetail(task) {
  if (/verifycenter\/captcha|captcha_container|安全验证|验证码/.test(String(task?.log || ""))) {
    return "抖音触发了安全验证，验证码遮挡了搜索结果";
  }
  const failureLine = String(task?.log || "").split("\n").find((line) => line.includes("失败："));
  return scrubProviderName(failureLine ? failureLine.replace(/^.*失败：\s*/, "") : task?.error_message || task?.phase || "未知错误");
}
function isVerificationFailure(task) {
  return /verifycenter\/captcha|captcha_container|安全验证|验证码/.test(`${task?.log || ""}\n${task?.error_message || ""}`);
}
function syncProgressNode(currentNode, nextNode) {
  if (!currentNode || !nextNode || currentNode.nodeType !== nextNode.nodeType) {
    currentNode?.replaceWith(nextNode?.cloneNode(true));
    return;
  }
  if (currentNode.nodeType === Node.TEXT_NODE) {
    if (currentNode.nodeValue !== nextNode.nodeValue) currentNode.nodeValue = nextNode.nodeValue;
    return;
  }
  if (currentNode.tagName !== nextNode.tagName) {
    currentNode.replaceWith(nextNode.cloneNode(true));
    return;
  }

  for (const attribute of [...currentNode.attributes]) {
    if (!nextNode.hasAttribute(attribute.name)) currentNode.removeAttribute(attribute.name);
  }
  for (const attribute of [...nextNode.attributes]) {
    if (currentNode.getAttribute(attribute.name) !== attribute.value) {
      currentNode.setAttribute(attribute.name, attribute.value);
    }
  }

  const currentChildren = [...currentNode.childNodes];
  const nextChildren = [...nextNode.childNodes];
  const childCount = Math.max(currentChildren.length, nextChildren.length);
  for (let index = 0; index < childCount; index += 1) {
    if (!currentChildren[index]) {
      currentNode.appendChild(nextChildren[index].cloneNode(true));
    } else if (!nextChildren[index]) {
      currentChildren[index].remove();
    } else {
      syncProgressNode(currentChildren[index], nextChildren[index]);
    }
  }
}
function updateSourceProgressMarkup(markup) {
  if (markup === lastSourceProgressMarkup) return;
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const nextRoot = template.content.firstElementChild;
  const currentRoot = sourceProgress.firstElementChild;
  if (!currentRoot || !nextRoot) {
    sourceProgress.replaceChildren(...template.content.childNodes);
  } else {
    syncProgressNode(currentRoot, nextRoot);
  }
  lastSourceProgressMarkup = markup;
}
function taskDisplayName(task) {
  if (task?.summary?.provider === "topic-advisor") return "爆款证据选题批次";
  if (task?.summary?.provider === "creator-agent") return task.creator_name || "博主智能体画像";
  if (task?.summary?.provider === "creator-agent-review") return `${task.creator_name || "博主智能体"} · 稿件审阅`;
  if (isViralTask(task)) return task.creator_name || String(task.source || "").replace("爆款拆解 / ", "") || "爆款拆解报告";
  if (isGetNotesTask(task)) return task.creator_name || String(task.source || "").replace(`${legacyProviderName}转写 / `, "").replace("文本提取 / ", "") || "所选作品";
  if (task?.source_mode === "favorites") return "我的收藏夹";
  return task.creator_name || `抖音号：${task.source}`;
}
function loopStrategyLabel(strategy) {
  return ({
    chrome_primary: "Chrome 首轮抓取",
    chrome_recovery: "Chrome 恢复抓取",
    api_supplement: "内部接口补充",
  })[strategy] || strategy || "";
}
function loopAttemptLabel(task) {
  const loop = task?.options?.loop;
  const attempt = Number(task?.progress?.attempt || loop?.currentAttempt || 0);
  const maxAttempts = Number(task?.progress?.maxAttempts || loop?.maxAttempts || 0);
  const strategy = loopStrategyLabel(task?.progress?.strategy || loop?.currentStrategy);
  if (!attempt && !strategy) return "";
  return [attempt ? `第 ${attempt}${maxAttempts ? ` / ${maxAttempts}` : ""} 轮` : "", strategy].filter(Boolean).join(" · ");
}
function auditDetail(task) {
  const summary = task.summary || {};
  if (task.source_mode === "favorites" && task.options?.kind === "favorites-discovery") {
    if (task.status === "waiting_for_user") return `已发现 ${summary.collectionCount || 0} 个收藏夹，等待你选择抓取范围。`;
    if (task.status === "failed" || task.status === "interrupted_recoverable") return `收藏夹目录读取失败：${taskFailureDetail(task)}`;
    return task.progress?.detail || task.phase || "正在读取收藏夹目录";
  }
  if (isViralTask(task)) {
    if (task.status === "waiting_for_user") return `爆款拆解已完成：${summary.totalCount || 0} 条作品，报告已保存到本地分析目录。`;
    if (task.status === "failed" || task.status === "interrupted_recoverable") return `爆款拆解失败：${taskFailureDetail(task)}`;
    return scrubProviderName(task.progress?.detail || task.phase);
  }
  if (isContentIntelligenceTask(task)) {
    if (task.status === "waiting_for_user") return `${taskKind(task)}已完成，本地产物可查看。`;
    if (task.status === "failed" || task.status === "interrupted_recoverable") return `${taskKind(task)}失败：${taskFailureDetail(task)}`;
    return scrubProviderName(task.progress?.detail || task.phase);
  }
  if (isGetNotesTask(task)) {
    const completed = Number(summary.completed || 0);
    const failed = Number(summary.failed || 0);
    if (failed) return `文本提取服务转写失败 ${failed} 条：${taskFailureDetail(task)}`;
    if (task.status === "waiting_for_user") return `文本提取已完成 ${completed} / ${summary.totalCount || completed} 条转写，可进入后续分析。`;
    return scrubProviderName(task.error_message || task.progress?.detail || task.phase);
  }
  const missing = Object.entries(summary.missing || {}).filter(([, count]) => count > 0).map(([field, count]) => `${field} 缺失 ${count} 条`);
  if (summary.foreignAuthorCount) missing.push(`异作者作品 ${summary.foreignAuthorCount} 条`);
  if (task.status === "waiting_for_action") return `自动恢复已暂停：${taskFailureDetail(task)}。系统不会继续请求，处理登录、验证码或限流问题后再重新抓取。`;
  if (task.status === "partial") return `待复核：主页显示 ${summary.pageTotal || "未知"} 条，抓到 ${summary.totalCount || 0} 条；${missing.join("；") || "字段需复核"}。原始 JSON 已保留，不能转写或分析。`;
  if (task.status === "failed" || task.status === "interrupted_recoverable") return `目录抓取失败：${taskFailureDetail(task)}`;
  if (task.status === "waiting_for_user" && summary.warningCount) return `JSON 审核通过：${summary.totalCount || 0} 条作品可用；${summary.warningCount} 条标题缺失已记为警告，不阻断转写或分析。`;
  if (task.status === "waiting_for_user") return `JSON 审核通过：${summary.totalCount || 0} 条作品已可查看。下一步是从目录中选择作品，再明确确认转写。`;
  return scrubProviderName(task.error_message || task.progress?.detail || task.phase);
}
function isFavoritesDiscoveryTask(task) { return task?.source_mode === "favorites" && task?.options?.kind === "favorites-discovery"; }
function showFavoritesCollections(collections, { taskId = "", refreshedAt = "", cached = false } = {}) {
  if (!collections.length) throw new Error("没有可选择的收藏夹");
  activeFavoritesDiscoveryTaskId = taskId;
  const cacheNote = refreshedAt ? `目录更新于 ${formatTime(refreshedAt)}${cached ? "，已直接使用本地缓存" : ""}。` : "";
  favoritesCollectionsSummary.textContent = `已读取 ${collections.length} 个收藏夹。${cacheNote} 可选择一个、多个或全部收藏夹；作品会跨收藏夹按 videoId 去重。`;
  favoritesCollectionsList.innerHTML = collections.map((collection) => `<label class="favorite-collection-option"><input type="checkbox" value="${escapeHtml(collection.id)}" data-favorite-collection /><span>${escapeHtml(collection.name)}</span><small>${Number(collection.count || 0) ? `${formatNumber(collection.count)} 条` : "数量待读取"}</small></label>`).join("");
  favoritesSelectAll.checked = false;
  favoritesConfirm.disabled = false;
  if (typeof favoritesCollectionsDialog.showModal === "function") favoritesCollectionsDialog.showModal();
  else favoritesCollectionsDialog.setAttribute("open", "");
}
async function openFavoritesCollections(task) {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/favorite-collections`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法读取收藏夹目录");
    showFavoritesCollections(Array.isArray(payload.collections) ? payload.collections : [], { taskId: task.id, refreshedAt: task.updated_at });
  } catch (error) { showToast(`读取收藏夹目录失败：${scrubProviderName(error.message)}`, "review"); }
}
async function openCachedFavoritesCollections() {
  const response = await fetch("/api/favorites-directory-cache");
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "无法读取收藏夹目录缓存");
  if (!payload.cache?.collections?.length) return false;
  showFavoritesCollections(payload.cache.collections, { refreshedAt: payload.cache.refreshedAt, cached: true });
  sourceStatus.textContent = `已使用 ${formatTime(payload.cache.refreshedAt)} 的收藏夹目录缓存；需要时可在弹窗中刷新。`;
  return true;
}
async function submitFavoritesCollections(collectionIds) {
  if (!collectionIds.length) return;
  favoritesConfirm.disabled = true;
  sourceStatus.textContent = `已选择 ${collectionIds.length === 1 && collectionIds[0] === "all" ? "全部" : collectionIds.length} 个收藏夹，正在创建抓取任务...`;
  try {
    const response = await fetch("/api/favorites-crawls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discoveryTaskId: activeFavoritesDiscoveryTaskId, collectionIds }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "创建收藏夹抓取任务失败");
    favoritesCollectionsDialog.close();
    activeSourceTaskId = payload.taskId;
    workbenchView.classList.remove("has-directory");
    sourceStatus.textContent = "已确认收藏夹范围，正在分页读取作品并跨文件夹去重。";
    pollDirectoryTask(payload.taskId);
  } catch (error) {
    favoritesConfirm.disabled = false;
    showToast(`创建收藏夹抓取任务失败：${scrubProviderName(error.message)}`, "review");
  }
}
function renderSourceProgress(task) {
  if (!task) { sourceProgress.hidden = true; return; }
  if (isGetNotesTask(task)) {
    const summary = task.summary || {};
    const total = Number(summary.totalCount || 0);
    const completed = Number(summary.completed || 0);
    const failed = Number(summary.failed || 0);
    const running = task.status === "running" || task.status === "queued";
    const hasError = task.status === "partial" || task.status === "failed" || task.status === "interrupted_recoverable";
    const count = hasError ? `失败 ${failed} / ${total} 条` : `完成 ${completed} / ${total} 条`;
    const nextStep = hasError
      ? "下一步：检查网络或系统代理。网络恢复后，回到作品目录重新选择这条作品提交；系统不会自动重试，也不会自动切换 Whisper。"
      : task.status === "waiting_for_user"
        ? "下一步：已获得转写内容，可在后续版本进入爆款拆解或知识蒸馏。"
        : "正在提交链接并等待文本提取结果，请保持本地服务运行。";
    sourceProgress.hidden = false;
    sourceProgress.classList.toggle("is-review", hasError);
    sourceProgress.classList.toggle("is-running", running);
    sourceProgress.classList.toggle("is-ready", task.status === "waiting_for_user");
    updateSourceProgressMarkup(`<div class="source-progress-shell"><div class="progress-orbit" aria-hidden="true"><i></i><b>${hasError ? "!" : running ? "转" : "✓"}</b></div><div class="source-progress-body"><div class="source-progress-header"><span class="live-label"><i class="activity-dot"></i>${hasError ? "连接失败" : running ? "正在转写" : escapeHtml(taskLabel(task.status))}</span><strong>文本提取</strong><code>${escapeHtml(taskDisplayName(task))}</code><small>${escapeHtml(count)}</small></div><p class="source-progress-detail">${escapeHtml(auditDetail(task))}</p><p class="source-progress-next">${escapeHtml(nextStep)}</p></div></div>`);
    return;
  }
  const progress = task.progress || {};
  const history = (task.progressHistory || []).slice(-5);
  const failed = task.status === "failed" || task.status === "interrupted_recoverable";
  const needsAction = task.status === "waiting_for_action";
  const review = task.status === "partial";
  const running = task.status === "running" || task.status === "queued";
  const ready = task.status === "waiting_for_user";
  const favoritesDiscovery = isFavoritesDiscoveryTask(task);
  const count = favoritesDiscovery && ready ? `${task.summary?.collectionCount || progress.discovered || 0} 个收藏夹` : failed ? "未生成可用目录" : progress.discovered != null ? `${progress.discovered}${progress.expectedTotal ? ` / ${progress.expectedTotal}` : ""} 条` : "正在等待第一条进度";
  const percent = progress.expectedTotal && progress.discovered != null ? Math.min(100, Math.round(progress.discovered / progress.expectedTotal * 100)) : 0;
  const nextStep = needsAction
    ? "下一步：进入账号中心处理登录、验证码或限流问题。确认账号恢复后，回到工作台重新提交；系统不会绕过风控继续请求。"
    : failed
    ? isVerificationFailure(task)
      ? "下一步：回输入框重新抓取；浏览器出现验证码时请直接完成验证，系统会自动继续。"
      : "本次抓取失败：请在任务中心查看失败日志；确认抖音登录态后，可回输入框重新抓取。"
    : review ? "下一步：先用当前规则重新审核现有 JSON；只有阻断问题仍存在时才需要重新抓取。" : favoritesDiscovery && ready ? "下一步：选择一个或多个收藏夹，确认后才会读取其中的作品。" : ready ? "下一步：打开作品目录，筛选作品后再确认是否转写。" : "系统正在自动抓取、去重和审核，请保持本地服务运行。";
  const actions = needsAction ? `<button class="progress-action primary" type="button" data-source-account-settings>处理账号问题</button><button class="progress-action" type="button" data-source-refetch="${escapeHtml(task.source)}">回输入框</button>` : failed ? `<button class="progress-action" type="button" data-source-refetch="${escapeHtml(task.source)}">回输入框重新抓取</button>` : review ? `<button class="progress-action primary" type="button" data-source-reaudit="${escapeHtml(task.id)}">重新审核 JSON</button><button class="progress-action" type="button" data-source-open="${escapeHtml(task.id)}" data-source-status="${escapeHtml(task.status)}" data-source-value="${escapeHtml(task.source)}">查看待复核目录</button>` : favoritesDiscovery && ready ? `<button class="progress-action primary" type="button" data-favorites-choose="${escapeHtml(task.id)}">选择收藏夹</button>` : ready ? `<button class="progress-action primary" type="button" data-source-open="${escapeHtml(task.id)}" data-source-status="${escapeHtml(task.status)}" data-source-value="${escapeHtml(task.source)}">打开作品目录</button>` : "";
  sourceProgress.hidden = false;
  sourceProgress.classList.toggle("is-review", review || failed || needsAction);
  sourceProgress.classList.toggle("is-running", running);
  sourceProgress.classList.toggle("is-ready", ready);
  const sourceIdentity = task.source_mode === "favorites" ? "收藏夹账号" : `抖音号 ${escapeHtml(task.source)}`;
  const loopLabel = loopAttemptLabel(task);
  updateSourceProgressMarkup(`<div class="source-progress-shell"><div class="progress-orbit" aria-hidden="true"><i></i><b>${running ? "抓" : failed || needsAction ? "!" : review ? "核" : favoritesDiscovery ? "选" : "✓"}</b></div><div class="source-progress-body"><div class="source-progress-header"><span class="live-label"><i class="activity-dot"></i>${escapeHtml(taskLabel(task.status))}</span><strong>${escapeHtml(favoritesDiscovery ? "收藏夹目录" : taskDisplayName(task))}</strong><code>${sourceIdentity}</code><small>${escapeHtml(count)}</small></div>${loopLabel ? `<p class="source-progress-loop">${escapeHtml(loopLabel)}</p>` : ""}<p class="source-progress-detail">${escapeHtml(auditDetail(task))}</p><p class="source-progress-next">${escapeHtml(nextStep)}</p>${progress.expectedTotal ? `<div class="source-progress-meter"><i style="width:${percent}%"></i></div>` : ""}${history.length ? `<div class="source-progress-history">${history.map((event) => `<span>${escapeHtml(event.label || event.stage || "处理中")}</span>`).join("")}</div>` : ""}</div>${actions ? `<div class="source-progress-actions">${actions}</div>` : ""}</div>`);
}

async function showTaskDirectory(taskId, status, source) {
  await loadWorksFromTask(taskId, source, status);
  setActiveView("workbench");
  sourceStatus.textContent = status === "partial" ? "当前是待复核目录：可查看和筛选，暂不可转写。" : "目录已打开：请选择要处理的作品。";
  mainPanel.scrollTop = 0;
  contentPanel.classList.remove("is-focused");
  requestAnimationFrame(() => contentPanel.classList.add("is-focused"));
  window.setTimeout(() => contentPanel.classList.remove("is-focused"), 1700);
  showToast(status === "partial" ? `已打开 ${creatorName.textContent} 的待复核目录，共 ${works.length} 条。` : `已打开 ${creatorName.textContent} 的作品目录，共 ${works.length} 条。`, status === "partial" ? "review" : "success");
}
function prepareTaskRefetch(source) {
  setActiveView("workbench");
  sourceInput.value = source;
  sourceInput.focus();
  sourceStatus.textContent = `已填入 ${source}。点击“获取内容目录”并确认后，才会重新抓取。`;
}

async function pollDirectoryTask(taskId) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`);
  const task = await response.json();
  if (!response.ok) throw new Error(task.error || "目录任务不存在");
  activeSourceTaskId = task.id;
  renderSourceProgress(task);
  if (task.status === "running" || task.status === "queued") {
    sourceStatus.textContent = `目录抓取中：${progressText(task)}`;
    refreshRuntimeViews();
    window.setTimeout(() => pollDirectoryTask(taskId).catch((error) => { sourceStatus.textContent = `读取任务状态失败：${scrubProviderName(error.message)}`; fetchDirectory.disabled = false; }), 1000);
    return task;
  }
  if (isFavoritesDiscoveryTask(task) && task.status === "waiting_for_user") {
    sourceStatus.textContent = `已发现 ${task.summary?.collectionCount || 0} 个收藏夹，请选择抓取范围。`;
    await openFavoritesCollections(task);
  } else {
    sourceStatus.textContent = task.status === "waiting_for_user" ? `JSON 审核通过，共 ${task.summary?.totalCount || 0} 条。请在下方选择作品。` : task.status === "partial" ? "JSON 待复核：已展示目录，但已禁用后续处理。" : `任务结束：${scrubProviderName(task.phase)}${task.error_message ? `（${scrubProviderName(task.error_message)}）` : ""}`;
    if (["waiting_for_user", "partial"].includes(task.status)) await loadWorksFromTask(task.id, task.source, task.status);
  }
  refreshRuntimeViews();
  fetchDirectory.disabled = false;
  return task;
}

fetchDirectory.addEventListener("click", async () => {
  const source = sourceInput.value.trim();
  if (!source) { sourceStatus.textContent = "请输入抖音号或分享链接后，再获取内容目录。"; sourceInput.focus(); return; }
  const sourceMode = source.includes("/video/") || source.includes("v.douyin.com") ? "single" : source.includes("favorite") || source.includes("收藏") ? "favorites" : "profile";
  const sourceLabel = sourceMode === "single" ? "单条作品" : sourceMode === "favorites" ? "本人收藏夹" : "博主主页";
  const accountLabel = sourceMode === "favorites" ? "收藏夹账号" : "内容采集账号";
  if (!window.confirm(`将创建${sourceLabel}目录任务，使用${accountLabel}，只生成和审核 JSON，不会调用文本提取服务。是否继续？`)) return;
  workbenchView.classList.remove("has-directory");
  const type = sourceLabel;
  creatorName.textContent = type === "单条作品" ? "单条作品目录" : "新识别博主";
  creatorMeta.textContent = `来源：${type} · ${source}`;
  fetchDirectory.disabled = true;
  sourceStatus.textContent = "正在创建真实目录抓取任务...";
  try {
    const response = await fetch("/api/directory-crawls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, sourceMode }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "创建任务失败");
    activeSourceTaskId = payload.taskId;
    sourceStatus.textContent = "已创建真实抓取任务，正在连接专用 Chrome Profile。";
    refreshRuntimeViews();
    pollDirectoryTask(payload.taskId).catch((error) => { sourceStatus.textContent = `读取任务状态失败：${scrubProviderName(error.message)}`; fetchDirectory.disabled = false; });
  } catch (error) { sourceStatus.textContent = `创建任务失败：${scrubProviderName(error.message)}`; fetchDirectory.disabled = false; }
});
document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => { sourceInput.value = button.dataset.example === "单条" ? "https://www.douyin.com/video/example" : button.dataset.example === "收藏" ? "我的收藏夹" : "demo_creator"; sourceInput.focus(); }));
document.querySelector("#fetch-favorites")?.addEventListener("click", async () => {
  sourceInput.value = "我的收藏夹";
  try {
    if (await openCachedFavoritesCollections()) return;
  } catch (error) {
    showToast(`读取收藏夹缓存失败：${scrubProviderName(error.message)}`, "review");
  }
  fetchDirectory.click();
});
favoritesRefresh?.addEventListener("click", () => {
  favoritesCollectionsDialog.close();
  sourceInput.value = "我的收藏夹";
  sourceStatus.textContent = "准备刷新收藏夹目录；确认后会打开收藏夹账号 Profile。";
  fetchDirectory.click();
});
favoritesSelectAll.addEventListener("change", () => { document.querySelectorAll("[data-favorite-collection]").forEach((input) => { input.checked = favoritesSelectAll.checked; }); });
favoritesCollectionsForm.addEventListener("submit", (event) => {
  if (event.submitter?.value === "cancel") return;
  event.preventDefault();
  const selected = [...document.querySelectorAll("[data-favorite-collection]:checked")].map((input) => input.value);
  if (!selected.length) { showToast("请至少选择一个收藏夹。", "review"); return; }
  submitFavoritesCollections(selected);
});
selectPage.addEventListener("change", () => { currentWorks().forEach((work) => selectPage.checked ? selectedIds.add(work.id) : selectedIds.delete(work.id)); render(); });
previousPage.addEventListener("click", () => { currentPage -= 1; render(); });
nextPage.addEventListener("click", () => { currentPage += 1; render(); });
pageSize.addEventListener("change", () => { currentPageSize = Number(pageSize.value); refreshForView(); });
document.querySelectorAll(".sort-button").forEach((button) => button.addEventListener("click", () => { sortKey = button.dataset.sort; document.querySelector(".sort-button.is-active")?.classList.remove("is-active"); button.classList.add("is-active"); refreshForView(); }));
[typeFilter, transcriptFilter, dateFilter, minLikes, minInteractions].forEach((control) => control.addEventListener("input", refreshForFilter));
document.querySelector("#top-content").addEventListener("click", () => {
  if (!works.length) { showToast("请先加载作品目录。", "review"); return; }
  const ranked = [...works].sort((left, right) => right.interactions - left.interactions || right.collects - left.collects || right.shares - left.shares || right.likes - left.likes);
  const candidateCount = Math.max(1, Math.ceil(ranked.length * 0.2));
  const candidates = ranked.slice(0, candidateCount);
  minInteractions.value = String(candidates.at(-1).interactions);
  selectedIds = new Set(candidates.map((work) => work.id));
  sortKey = "interactions";
  document.querySelector(".sort-button.is-active")?.classList.remove("is-active");
  document.querySelector('.sort-button[data-sort="interactions"]')?.classList.add("is-active");
  currentPage = 1;
  render();
  selectionNote.textContent = `已按总互动筛出并勾选前 ${candidateCount} 条高价值作品。你可以取消个别作品，再继续转写或爆款拆解。`;
  showToast(`已展示并勾选 ${candidateCount} 条高价值作品。`, "success");
});
document.querySelector("#reset-filters").addEventListener("click", () => { typeFilter.value = "all"; transcriptFilter.value = "all"; dateFilter.value = "all"; minLikes.value = ""; minInteractions.value = ""; refreshForFilter(); });
selectFiltered.addEventListener("click", () => { activeWorks().forEach((work) => selectedIds.add(work.id)); render(); });
screenSelected.addEventListener("click", () => {
  const chosen = works.filter((work) => selectedIds.has(work.id));
  if (!chosen.length) { showToast("请先选择至少一条作品。", "review"); return; }
  const ranked = [...chosen].sort((left, right) => right.interactions - left.interactions || right.collects - left.collects || right.shares - left.shares || right.likes - left.likes);
  const candidateCount = Math.max(1, Math.ceil(ranked.length * 0.2));
  const candidates = ranked.slice(0, candidateCount);
  selectedIds = new Set(candidates.map((work) => work.id));
  minInteractions.value = String(candidates.at(-1).interactions);
  sortKey = "interactions";
  document.querySelector(".sort-button.is-active")?.classList.remove("is-active");
  document.querySelector('.sort-button[data-sort="interactions"]')?.classList.add("is-active");
  currentPage = 1;
  render();
  selectionNote.textContent = `已按总互动优先、收藏、转发和点赞辅助排序，从 ${chosen.length} 条作品中筛出 ${candidateCount} 条候选爆款。你可以继续调整筛选条件或直接转写所选作品。`;
  showToast(`爆款初筛完成：${chosen.length} 条中筛出 ${candidateCount} 条候选。`, "success");
});
function renderBreakdownTask(task) {
  const running = ["queued", "running"].includes(task.status);
  breakdownProgress.hidden = !running;
  if (!running) return;
  const labels = { queued: "等待分析模型执行位", loading_evidence: "读取 JSON 与转写证据", requesting_model: "分析模型正在拆解", completed: "正在保存本地报告" };
  breakdownStatus.textContent = labels[task.progress?.stage] || labels[task.status] || task.phase;
  breakdownPath.textContent = task.progress?.detail || "分析任务已经进入本地队列。";
  breakdownProgress.querySelector("strong").textContent = labels[task.progress?.stage] || task.phase;
  breakdownProgress.querySelector("small").textContent = task.progress?.detail || `任务 ${task.id}`;
  breakdownReport.hidden = true;
  openBreakdownFolder.hidden = true;
}
async function loadViralReport(reportId) {
  const response = await fetch(`/api/viral-reports/${encodeURIComponent(reportId)}`); const report = await readApiPayload(response, "读取爆款拆解报告失败");
  if (!response.ok) throw new Error(report.error || "读取爆款拆解报告失败");
  activeBreakdownReportId = report.id;
  breakdownProgress.hidden = true;
  breakdownStatus.textContent = report.status === "completed" ? `${report.creator_name || report.douyin_id} · ${report.workIds.length} 条作品拆解` : "爆款拆解未完成";
  breakdownPath.textContent = report.output_path || report.error_message || "尚未生成报告文件";
  breakdownReport.textContent = report.content || report.error_message || "报告暂无内容";
  breakdownReport.hidden = false;
  openBreakdownFolder.hidden = report.status !== "completed";
  useBreakdownForTopics.hidden = report.status !== "completed";
  openBreakdownFolder.dataset.reportId = report.id;
  useBreakdownForTopics.dataset.reportId = report.id;
  setActiveView("breakdown");
}
async function pollBreakdownTask(taskId, reportId) {
  const pollToken = ++activeBreakdownPoll;
  const poll = async () => {
    if (pollToken !== activeBreakdownPoll) return;
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`); const task = await response.json();
      if (!response.ok) throw new Error(task.error || "分析任务不存在");
      renderBreakdownTask(task);
      refreshRuntimeViews();
      if (["queued", "running"].includes(task.status)) return setTimeout(poll, 1000);
      if (task.status === "waiting_for_user") {
        await loadViralReport(reportId);
        selectionNote.textContent = "爆款拆解已完成，报告已保存并进入历史报告。";
        showToast("爆款拆解报告已生成并保存到本地。", "success");
      } else {
        breakdownProgress.hidden = true; breakdownStatus.textContent = "爆款拆解失败"; breakdownPath.textContent = scrubProviderName(task.error_message || task.phase); breakdownReport.textContent = `失败原因：${scrubProviderName(task.error_message || task.phase)}\n\n下一步：检查模型配置和网络后，可在任务中心或历史报告中点击“重新拆解”。`; breakdownReport.hidden = false;
        showToast(`爆款拆解失败：${scrubProviderName(task.error_message || task.phase)}`, "review");
      }
      await refreshViralReports();
    } catch (error) { breakdownStatus.textContent = "无法读取分析进度"; breakdownPath.textContent = scrubProviderName(error.message); }
  };
  poll();
}
async function submitBreakdown(crawlTaskId, videoIds, requireConfirmation = true) {
  if (!crawlTaskId || !videoIds.length) { showToast("请先选择已完成转写的作品。", "review"); return; }
  if (requireConfirmation && !window.confirm(`将向项目配置的分析模型提交 ${videoIds.length} 条已转写作品。模型将读取对应本地 Markdown，生成一份可追溯的本地爆款拆解报告；不会再次调用文本提取服务。是否继续？`)) return;
  analyzeSelected.disabled = true;
  try {
    const response = await fetch("/api/viral-breakdowns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crawlTaskId, videoIds }) }); const payload = await readApiPayload(response, "创建爆款拆解失败");
    if (!response.ok) throw new Error(payload.error || "创建爆款拆解失败");
    selectionNote.textContent = `已创建 ${videoIds.length} 条作品的爆款拆解任务，可在任务中心查看进度。`;
    breakdownStatus.textContent = "分析任务已创建"; breakdownPath.textContent = `任务 ${payload.taskId}`; breakdownReport.hidden = true; openBreakdownFolder.hidden = true;
    setActiveView("breakdown");
    pollBreakdownTask(payload.taskId, payload.reportId);
  } catch (error) {
    breakdownStatus.textContent = "爆款拆解未创建"; breakdownPath.textContent = scrubProviderName(error.message); breakdownReport.hidden = true;
    selectionNote.textContent = `爆款拆解失败：${scrubProviderName(error.message)}`; showToast(`爆款拆解失败：${scrubProviderName(error.message)}`, "review");
  } finally { renderSelection(); }
}
analyzeSelected.addEventListener("click", () => submitBreakdown(currentCrawlTaskId, [...selectedIds]));
function chooseTranscriptionProvider() {
  return new Promise((resolve) => {
    const onClose = () => {
      transcriptionProviderDialog.removeEventListener("close", onClose);
      resolve(["getnotes", "whisper"].includes(transcriptionProviderDialog.returnValue) ? transcriptionProviderDialog.returnValue : "");
    };
    transcriptionProviderDialog.addEventListener("close", onClose);
    transcriptionProviderDialog.showModal();
  });
}
transcribeSelected.addEventListener("click", async () => {
  if (!currentCrawlTaskId) { selectionNote.textContent = "请先加载一份已审核的真实 JSON，再选择作品进入文本提取。"; return; }
  const count = selectedIds.size;
  const provider = await chooseTranscriptionProvider();
  if (!provider) return;
  const providerLabel = provider === "whisper" ? "本地 Whisper" : "云端链接提取";
  if (provider === "whisper" && works.some((work) => selectedIds.has(work.id) && work.contentType === "图文")) {
    showToast("本地 Whisper 不能处理图文作品，请改用云端链接提取。", "review");
    return;
  }
  if (!window.confirm(provider === "whisper"
    ? `将下载 ${count} 条视频并在本机串行执行 Whisper。会生成原文、时间轴 JSON 和 SRT，不消耗云端额度。是否继续？`
    : `将提交 ${count} 条抖音链接到云端提取服务。最多消耗 ${count} 次配额，失败后不会静默切换 Whisper。是否继续？`)) return;
  transcribeSelected.disabled = true; selectionNote.textContent = `正在创建 ${count} 条${providerLabel}任务...`;
  try {
    const response = await fetch("/api/transcriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crawlTaskId: currentCrawlTaskId, videoIds: [...selectedIds], provider }) }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "创建转写任务失败");
    activeSourceTaskId = payload.taskId;
    selectionNote.textContent = `${providerLabel}任务已创建，正在等待结果...`;
    showToast(`已提交 ${count} 条${providerLabel}任务，页面会自动同步结果。`);
    refreshRuntimeViews();
    const poll = async () => {
      const taskResponse = await fetch(`/api/tasks/${payload.taskId}`);
      const task = await taskResponse.json();
      const summary = task.summary || {};
      if (["queued", "running"].includes(task.status)) {
        selectionNote.textContent = `${providerLabel}处理中：${task.progress?.label || task.phase || "等待进度"}。`;
        window.setTimeout(poll, 1000);
      } else if (task.status === "waiting_for_user") {
        selectionNote.textContent = `${providerLabel}完成：${summary.completed || 0} / ${summary.totalCount || count} 条。`;
        showToast(`${providerLabel}完成：${summary.completed || 0} / ${summary.totalCount || count} 条。`, "success");
      } else {
        selectionNote.textContent = `${providerLabel}失败：${taskFailureDetail(task)}。请查看任务日志后重新提交。`;
        showToast(`${providerLabel}失败：${taskFailureDetail(task)}`, "review");
      }
      refreshRuntimeViews();
    };
    poll();
  } catch (error) { selectionNote.textContent = `创建转写任务失败：${scrubProviderName(error.message)}`; } finally { transcribeSelected.disabled = false; }
});
async function refreshDistillationPool() {
  if (!currentCrawlTaskId) { distillationPoolStatus.textContent = "尚未选择博主素材"; distillationPoolMeta.textContent = "先在内容工作台抓取目录并选择已转写作品。"; distillationPoolList.innerHTML = ""; return; }
  const response = await fetch(`/api/distillation-pool?crawlTaskId=${encodeURIComponent(currentCrawlTaskId)}`); const payload = await response.json(); const sourceIds = new Set((payload.sources || []).map((item) => String(item.video_id))); const sources = works.filter((work) => sourceIds.has(work.id)); const count = sources.length;
  distillationPoolStatus.textContent = count ? `已收录 ${count} 条代表作` : "素材池为空";
  distillationPoolMeta.textContent = count < 10 ? `当前 ${count} 条：不足以蒸馏博主画像，请补充不同主题和时期的代表作。` : count < 20 ? `当前 ${count} 条：可建立基础画像，但需补充主题覆盖后再做正式蒸馏。` : `当前 ${count} 条：具备生成较完整博主方法论的基础，仍需人工确认素材代表性。`;
  distillationPoolList.innerHTML = sources.map((work) => `<div class="pool-item"><span>${escapeHtml(work.title)}</span><small>${escapeHtml(work.date)}｜总互动 ${formatNumber(work.interactions)}</small></div>`).join("") || '<p class="pool-empty">从内容工作台选择多条已转写的代表作，加入这里后再进行知识蒸馏。</p>';
}
distillSelected.addEventListener("click", async () => {
  if (!currentCrawlTaskId || !selectedIds.size) return;
  try { const response = await fetch("/api/distillation-pool", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ crawlTaskId: currentCrawlTaskId, videoIds: [...selectedIds] }) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "加入素材池失败"); selectionNote.textContent = `已将 ${payload.sources.length} 条已转写作品纳入蒸馏素材池。请在博主智能体中检查主题与时间覆盖。`; await refreshDistillationPool(); setActiveView("agent"); } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
function viralReportStatus(report) { return ({ queued: "排队中", running: "分析中", completed: "已完成", failed: "失败" })[report.status] || report.status; }
async function refreshViralReports() {
  try {
    const response = await fetch("/api/viral-reports"); const payload = await readApiPayload(response, "读取报告索引失败");
    if (!response.ok) throw new Error(payload.error || "读取报告索引失败");
    const reports = payload.reports || []; viralReportsById = new Map(reports.map((report) => [report.id, report]));
    const signature = JSON.stringify(reports.map((report) => [report.id, report.status, report.updated_at, report.output_path, report.error_message]));
    breakdownHistoryStatus.textContent = reports.length ? `共 ${reports.length} 份本地报告` : "还没有生成报告";
    if (signature === lastViralReportSignature) return;
    lastViralReportSignature = signature;
    breakdownHistoryList.innerHTML = reports.map((report) => {
      const completed = report.status === "completed";
      const duration = report.metadata?.durationMs ? `${Math.round(report.metadata.durationMs / 1000)} 秒` : "-";
      const tokens = report.metadata?.usage?.total_tokens ?? report.metadata?.usage?.totalTokens ?? null;
      return `<article class="breakdown-history-item"><div><span class="task-status ${completed ? "ready" : report.status === "failed" ? "failed" : "queued"}">${viralReportStatus(report)}</span><strong>${escapeHtml(report.creator_name || report.douyin_id || "未知博主")}</strong><small>${formatTime(report.created_at)} · ${report.workIds.length} 条作品 · ${escapeHtml(report.model || "等待模型")}</small></div><dl><div><dt>耗时</dt><dd>${escapeHtml(duration)}</dd></div><div><dt>Token</dt><dd>${tokens == null ? "-" : formatNumber(tokens)}</dd></div></dl><div class="breakdown-history-actions">${completed ? `<button class="primary-button" type="button" data-report-open="${escapeHtml(report.id)}">查看报告</button><button class="outline-button" type="button" data-report-folder="${escapeHtml(report.id)}">打开文件夹</button>` : `<span>${escapeHtml(report.error_message || "任务处理中")}</span>`}<button class="text-button" type="button" data-report-rerun="${escapeHtml(report.id)}">重新拆解</button></div></article>`;
    }).join("") || '<p class="task-center-note">从内容工作台选择已转写作品，确认后生成第一份爆款拆解报告。</p>';
  } catch (error) { breakdownHistoryStatus.textContent = scrubProviderName(error.message); }
}
function topicBatchLabel(batch) {
  return ({ queued: "排队中", running: "生成中", completed: "已完成", failed: "失败" })[batch.status] || batch.status;
}
function renderTopicBatch(batch) {
  if (!batch) {
    topicBatchStatus.textContent = "尚未生成选题";
    topicPositioning.textContent = "选择一份或多份已完成的爆款拆解报告开始。";
    topicCardList.innerHTML = '<div class="intelligence-empty"><strong>先有证据，再给选题</strong><p>选题顾问不会凭空生成标题。完成爆款拆解后，选择报告生成第一批候选选题。</p></div>';
    openTopicFolder.hidden = true;
    return;
  }
  const topics = batch.topics || [];
  topicBatchStatus.textContent = batch.status === "completed" ? `${topics.length} 个证据选题` : topicBatchLabel(batch);
  topicPositioning.textContent = batch.metadata?.positioning || batch.error_message || (batch.status === "running" ? "正在读取爆款证据并生成差异化选题。" : "等待选题顾问输出。");
  topicCardList.innerHTML = topics.map((topic) => `<article class="topic-card"><div class="topic-card-top"><span>${String(topic.order || "").padStart(2, "0")}</span><strong>${escapeHtml(topic.format || "口播")}</strong><i>${formatNumber(topic.confidence || 0)}%</i></div><h3>${escapeHtml(topic.title)}</h3><p>${escapeHtml(topic.hook)}</p><dl><div><dt>核心角度</dt><dd>${escapeHtml(topic.angle)}</dd></div><div><dt>用户痛点</dt><dd>${escapeHtml(topic.audiencePain || "待补充")}</dd></div><div><dt>拍前核验</dt><dd>${escapeHtml(topic.validationNeeded?.join("；") || "无额外核验项")}</dd></div>${topic.risk ? `<div><dt>误用风险</dt><dd>${escapeHtml(topic.risk)}</dd></div>` : ""}</dl><footer><span>报告 ${formatNumber(topic.sourceReportIds?.length || 0)} 份</span><span>作品证据 ${formatNumber(topic.evidenceWorkIds?.length || 0)} 条</span><b>${escapeHtml(topic.status || "候选")}</b></footer></article>`).join("") || `<div class="intelligence-empty"><strong>${escapeHtml(topicBatchLabel(batch))}</strong><p>${escapeHtml(batch.error_message || "任务完成后会在这里显示选题卡片。")}</p></div>`;
  openTopicFolder.hidden = batch.status !== "completed";
  openTopicFolder.dataset.batchId = batch.id;
}
async function refreshTopicAdvisor(force = false) {
  try {
    const [reportResponse, batchResponse] = await Promise.all([fetch("/api/viral-reports"), fetch("/api/topic-batches")]);
    const reportPayload = await readApiPayload(reportResponse, "读取爆款报告失败");
    const batchPayload = await readApiPayload(batchResponse, "读取选题批次失败");
    const reports = (reportPayload.reports || []).filter((report) => report.status === "completed");
    const batches = batchPayload.batches || [];
    topicReportsById = new Map(reports.map((report) => [report.id, report]));
    const validReportIds = new Set(reports.map((report) => report.id));
    selectedTopicReportIds = new Set([...selectedTopicReportIds].filter((id) => validReportIds.has(id)));
    const creatorKey = (report) => String(report.douyin_id || report.creator_name || "unknown");
    if (!topicComparisonMode && selectedTopicReportIds.size) {
      const firstCreator = creatorKey(topicReportsById.get([...selectedTopicReportIds][0]));
      selectedTopicReportIds = new Set([...selectedTopicReportIds].filter((id) => creatorKey(topicReportsById.get(id)) === firstCreator));
    }
    if (!selectedTopicReportIds.size && reports.length) {
      const firstCreator = creatorKey(reports[0]);
      selectedTopicReportIds = new Set(reports.filter((report) => creatorKey(report) === firstCreator).map((report) => report.id));
    }
    const signature = JSON.stringify([topicComparisonMode, reports.map((report) => [report.id, report.updated_at]), batches.map((batch) => [batch.id, batch.status, batch.updated_at, batch.error_message]), [...selectedTopicReportIds]]);
    if (!force && signature === lastTopicSignature) return;
    lastTopicSignature = signature;
    const completedBatches = batches.filter((batch) => batch.status === "completed");
    const topicCount = completedBatches.reduce((total, batch) => total + (batch.topics?.length || 0), 0);
    document.querySelector("#topic-report-count").textContent = formatNumber(reports.length);
    document.querySelector("#topic-batch-count").textContent = formatNumber(completedBatches.length);
    document.querySelector("#topic-candidate-count").textContent = formatNumber(topicCount);
    const reportGroups = new Map();
    reports.forEach((report) => {
      const key = creatorKey(report);
      if (!reportGroups.has(key)) reportGroups.set(key, []);
      reportGroups.get(key).push(report);
    });
    topicSourceList.innerHTML = [...reportGroups.entries()].map(([key, groupReports]) => `<section class="topic-source-group"><header><strong>${escapeHtml(groupReports[0].creator_name || key)}</strong><span>${groupReports.length} 份报告</span></header>${groupReports.map((report) => `<label class="topic-source-item"><input type="checkbox" data-topic-report data-topic-creator="${escapeHtml(key)}" value="${escapeHtml(report.id)}"${selectedTopicReportIds.has(report.id) ? " checked" : ""} /><span><strong>${formatTime(report.created_at)}</strong><small>${report.workIds.length} 条作品 · ${escapeHtml(report.model || "分析模型")}</small></span></label>`).join("")}</section>`).join("") || '<div class="intelligence-empty compact"><strong>暂无爆款报告</strong><p>先在内容工作台选择已转写作品，完成一次爆款拆解。</p></div>';
    topicComparisonModeInput.checked = topicComparisonMode;
    const running = batches.find((batch) => ["queued", "running"].includes(batch.status));
    topicGenerationProgress.hidden = !running;
    generateTopics.disabled = !selectedTopicReportIds.size || Boolean(running);
    generateTopics.textContent = running ? "选题生成中..." : `生成证据选题 · ${selectedTopicReportIds.size} 份报告`;
    const selectedBatch = batches.find((batch) => batch.id === activeTopicBatchId) || running || completedBatches[0] || batches[0] || null;
    if (selectedBatch) activeTopicBatchId = selectedBatch.id;
    renderTopicBatch(selectedBatch);
    topicBatchHistory.innerHTML = batches.slice(0, 8).map((batch) => `<button class="compact-history-item${batch.id === activeTopicBatchId ? " is-active" : ""}" type="button" data-topic-batch-open="${escapeHtml(batch.id)}"><span class="task-status ${batch.status === "completed" ? "ready" : batch.status === "failed" ? "failed" : "queued"}">${escapeHtml(topicBatchLabel(batch))}</span><strong>${formatNumber(batch.topics?.length || 0)} 个选题</strong><small>${formatTime(batch.created_at)} · ${formatNumber(batch.reportIds?.length || 0)} 份报告</small></button>`).join("") || '<p class="task-center-note">还没有选题批次。</p>';
  } catch (error) {
    topicBatchStatus.textContent = "选题顾问暂不可用";
    topicPositioning.textContent = scrubProviderName(error.message);
  }
}
function agentReadinessLabel(group) {
  if (group.readiness === "ready") return { label: "正式画像就绪", className: "ready", description: `${group.transcriptCount} 条材料，已达到较完整画像建议线。` };
  if (group.readiness === "trial") return { label: "可生成试用画像", className: "queued", description: `${group.transcriptCount} 条材料，可以试用，但结论需要更多作品验证。` };
  return { label: "材料不足", className: "review", description: `${group.transcriptCount} 条材料，至少需要 5 条已转写代表作。` };
}
async function refreshAgentWorkbench(force = false) {
  try {
    const [readinessResponse, agentsResponse] = await Promise.all([fetch("/api/creator-agent-readiness"), fetch("/api/creator-agents")]);
    const readinessPayload = await readApiPayload(readinessResponse, "读取博主材料失败");
    const agentsPayload = await readApiPayload(agentsResponse, "读取博主智能体失败");
    const creators = readinessPayload.creators || [];
    const agents = agentsPayload.agents || [];
    if (!creators.some((creator) => creator.douyinId === selectedAgentCreator)) selectedAgentCreator = creators[0]?.douyinId || "";
    const signature = JSON.stringify([selectedAgentCreator, creators.map((creator) => [creator.douyinId, creator.transcriptCount, creator.latestAgent?.id, creator.latestAgent?.status, creator.latestAgent?.updated_at]), agents.map((agent) => [agent.id, agent.status, agent.updated_at, agent.error_message])]);
    if (!force && signature === lastAgentSignature) return;
    lastAgentSignature = signature;
    document.querySelector("#agent-creator-count").textContent = formatNumber(creators.length);
    document.querySelector("#agent-ready-count").textContent = formatNumber(creators.filter((creator) => creator.readiness !== "insufficient").length);
    document.querySelector("#agent-profile-count").textContent = formatNumber(agents.filter((agent) => agent.status === "completed").length);
    agentCreatorList.innerHTML = creators.map((creator) => {
      const readiness = agentReadinessLabel(creator);
      return `<button class="agent-creator-item${creator.douyinId === selectedAgentCreator ? " is-active" : ""}" type="button" data-agent-creator="${escapeHtml(creator.douyinId)}"><span>${escapeHtml((creator.creatorName || creator.douyinId).slice(0, 1))}</span><div><strong>${escapeHtml(creator.creatorName || creator.douyinId)}</strong><small>${escapeHtml(creator.douyinId)} · ${formatNumber(creator.transcriptCount)} 条转写</small></div><i class="${readiness.className}"></i></button>`;
    }).join("") || '<div class="intelligence-empty compact"><strong>还没有可用材料</strong><p>先在内容工作台完成至少 5 条同一博主的作品转写。</p></div>';
    const selected = creators.find((creator) => creator.douyinId === selectedAgentCreator);
    if (!selected) {
      agentReadinessCard.innerHTML = '<div><span class="task-status queued">尚无材料</span><h2>完成转写后再建立博主智能体</h2><p>素材必须来自同一博主，并覆盖多个主题或时期。</p></div>';
      generateCreatorAgent.disabled = true;
      return;
    }
    const readiness = agentReadinessLabel(selected);
    const latestAgent = agents.find((agent) => agent.id === selected.latestAgent?.id) || agents.find((agent) => agent.douyin_id === selected.douyinId && agent.status === "completed") || agents.find((agent) => agent.douyin_id === selected.douyinId);
    activeCreatorAgentId = latestAgent?.id || "";
    activeCreatorAgentStatus = latestAgent?.status || "";
    agentReadinessCard.innerHTML = `<div><span class="task-status ${readiness.className}">${readiness.label}</span><h2>${escapeHtml(selected.creatorName)}</h2><p>${escapeHtml(readiness.description)} 当前材料将按作品 ID 去重，本地 Whisper 版本优先。</p></div><dl><div><dt>已转写</dt><dd>${formatNumber(selected.transcriptCount)} 条</dd></div><div><dt>建议线</dt><dd>10 条</dd></div><div><dt>当前画像</dt><dd>${latestAgent?.status === "completed" ? "已生成" : latestAgent ? topicBatchLabel(latestAgent) : "未生成"}</dd></div></dl>`;
    const running = latestAgent && ["queued", "running"].includes(latestAgent.status);
    generateCreatorAgent.disabled = Boolean(running) || (!latestAgent && selected.readiness === "insufficient");
    generateCreatorAgent.textContent = running ? "智能体生成中..." : latestAgent?.status === "completed" ? "查看并使用智能体" : latestAgent?.status === "failed" ? "重新生成智能体画像" : selected.readiness === "ready" ? "生成正式智能体画像" : "生成试用智能体画像";
    agentGenerationProgress.hidden = !running;
    openAgentFolder.hidden = latestAgent?.status !== "completed";
    reviewDraft.disabled = latestAgent?.status !== "completed";
    draftReviewState.textContent = latestAgent?.status === "completed" ? "画像已就绪，可以审稿" : "需要先生成画像";
    if (latestAgent?.status === "completed") {
      const response = await fetch(`/api/creator-agents/${encodeURIComponent(latestAgent.id)}`);
      const detail = await readApiPayload(response, "读取智能体画像失败");
      creatorAgentStatus.textContent = `${selected.creatorName} · 已生成 · ${detail.metadata?.materialCount || selected.transcriptCount} 条材料 · ${detail.model || "模型未记录"} · ${formatTime(detail.updated_at)}`;
      creatorAgentProfile.textContent = stripAssetFrontmatter(detail.content) || "画像文件暂无正文。";
      creatorAgentProfile.title = detail.output_path || "";
      openAgentFolder.dataset.agentId = latestAgent.id;
      const reviewsResponse = await fetch(`/api/agent-reviews?agentId=${encodeURIComponent(latestAgent.id)}`);
      const reviewsPayload = await readApiPayload(reviewsResponse, "读取审稿记录失败");
      const latestReview = reviewsPayload.reviews?.[0];
      if (latestReview?.status === "completed") {
        const reviewResponse = await fetch(`/api/agent-reviews/${encodeURIComponent(latestReview.id)}`);
        const reviewDetail = await readApiPayload(reviewResponse, "读取审稿结果失败");
        draftReviewOutput.textContent = stripAssetFrontmatter(reviewDetail.content);
        draftReviewOutput.hidden = !reviewDetail.content;
        draftReviewState.textContent = `最近审稿完成 · ${formatTime(latestReview.updated_at)}`;
      } else if (latestReview && ["queued", "running"].includes(latestReview.status)) {
        reviewDraft.disabled = true;
        draftReviewState.textContent = "智能体正在审稿...";
      } else if (latestReview?.status === "failed") {
        draftReviewState.textContent = `上次审稿失败：${scrubProviderName(latestReview.error_message)}`;
      }
    } else {
      activeCreatorAgentStatus = latestAgent?.status || "";
      creatorAgentStatus.textContent = latestAgent?.status === "failed" ? "上次生成失败" : "尚未生成";
      creatorAgentProfile.textContent = latestAgent?.error_message || "生成后会在这里显示带证据引用的博主画像。";
      draftReviewOutput.hidden = true;
    }
  } catch (error) {
    creatorAgentStatus.textContent = "博主智能体暂不可用";
    creatorAgentProfile.textContent = scrubProviderName(error.message);
  }
}
function setActiveView(view) {
  if (!Object.hasOwn(viewNames, view) || !document.querySelector(`#${view}-view`)) view = "workbench";
  viewPanels.forEach((panel) => { panel.hidden = panel.id !== `${view}-view`; panel.classList.toggle("is-active", panel.id === `${view}-view`); });
  document.querySelector(".nav-item.is-active")?.classList.remove("is-active");
  document.querySelector(`.nav-item[data-view="${view}"]`)?.classList.add("is-active");
  document.querySelector("[data-open-settings]")?.classList.toggle("is-active", view === "settings");
  viewTitle.textContent = viewNames[view];
  mainPanel.scrollTop = 0;
  const activePanel = document.querySelector(`#${view}-view`);
  if (activePanel) activePanel.scrollTop = 0;
  if (view === "agent") refreshAgentWorkbench(true);
  if (view === "breakdown") refreshViralReports();
  if (view === "topics") refreshTopicAdvisor(true);
  localStorage.setItem(activeViewKey, view);
}
function renderStorageLocation() {
  const root = storageRoots[storageMode];
  document.querySelectorAll("[data-asset-root]").forEach((element) => { element.textContent = root; });
  document.querySelectorAll("[data-asset-path]").forEach((element) => { element.textContent = `${root}\\${element.dataset.assetPath}`; });
  document.querySelector("#storage-mode-label").textContent = storageMode === "obsidian" ? "Obsidian 库" : "本地文件夹";
  document.querySelectorAll("[data-storage-mode]").forEach((button) => button.classList.toggle("is-selected", button.dataset.storageMode === storageMode));
  document.querySelector("[data-open-storage] strong").textContent = storageMode === "obsidian" ? "Obsidian 库" : "本地文件夹";
}
function escapeHtml(value) { return scrubProviderName(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }
function formatTime(value) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "-"; }
function taskLabel(status) { return ({ queued: "排队中", running: "处理中", waiting_for_action: "等待人工处理", waiting_for_user: "可选择作品", partial: "待复核", failed: "任务失败", interrupted_recoverable: "服务中断" })[status] || status; }
function taskStatusLabel(task) { return isAnalysisTask(task) && task.status === "waiting_for_user" ? "分析完成" : isAnalysisTask(task) && task.status === "failed" ? "分析失败" : isGetNotesTask(task) && task.status === "waiting_for_user" ? "转写已完成" : taskLabel(task.status); }
function matchesTaskFilter(task, filter) {
  if (!filter) return true;
  if (filter === "active") return ["queued", "running"].includes(task.status);
  if (filter === "action") return task.status === "waiting_for_action";
  if (filter === "review") return task.status === "partial";
  if (filter === "failed") return ["failed", "interrupted_recoverable"].includes(task.status);
  if (filter === "ready") return task.status === "waiting_for_user";
  return true;
}
function matchesTaskType(task, filter) {
  if (!filter) return true;
  if (filter === "directory") return isDirectoryTask(task);
  if (filter === "transcription") return isGetNotesTask(task);
  if (filter === "analysis") return isAnalysisTask(task);
  return true;
}
function taskFilterLabel(filter) { return ({ active: "进行中", action: "需处理", review: "待复核", failed: "失败", ready: "产物就绪" })[filter] || "全部"; }
function taskClass(status) { return ({ queued: "queued", waiting_for_action: "review", waiting_for_user: "ready", partial: "review", failed: "failed", interrupted_recoverable: "failed" })[status] || ""; }
function progressText(task) { const progress = task.progress || {}; const counts = progress.discovered != null ? `${progress.discovered}${progress.expectedTotal ? ` / ${progress.expectedTotal}` : ""} 条` : ""; return scrubProviderName([progress.label || task.phase, progress.detail, counts].filter(Boolean).join(" · ")); }
function taskLogTail(task) { return scrubProviderName(String(task.log || "").split(/\r?\n/).filter(Boolean).slice(-20).join("\n")); }
function mapWork(work) {
  const likes = Number(work.likes || 0); const comments = Number(work.commentCount || 0); const collects = Number(work.collectCount || 0); const shares = Number(work.shareCount || 0);
  const id = String(work.videoId); const isImage = work.hasImages || work.contentType === "image"; const titleMissing = !String(work.title || "").trim();
  return { id, title: titleMissing ? `未命名${isImage ? "图文" : "视频"} · ${id}` : work.title, titleMissing, description: work.desc || work.title || "", date: work.date || "-", contentType: isImage ? "图文" : "视频", likes, comments, collects, shares, interactions: Number(work.interactionTotal || likes + comments + collects + shares), transcript: "未转写", transcriptStatus: "", transcriptError: "", douyinUrl: work.videoUrl || work.shareUrl || "#", authorNickname: work.authorNickname || "", authorAvatarUrl: work.authorAvatarUrl || "" };
}
function avatarMarkup(url, fallback, className) {
  const safeUrl = /^https?:\/\//.test(url || "") ? url : "";
  return `<span class="${className}"><span class="avatar-fallback">${escapeHtml(fallback || "抖")}</span>${safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="" referrerpolicy="no-referrer" />` : ""}</span>`;
}
function applyTranscriptJobs(jobs) {
  const byVideo = new Map();
  jobs.forEach((job) => {
    const key = String(job.video_id);
    const group = byVideo.get(key) || [];
    group.push(job);
    byVideo.set(key, group);
  });
  works.forEach((work) => {
    const group = byVideo.get(work.id) || [];
    const job = group.find((item) => ["queued", "running"].includes(item.status))
      || group.find((item) => item.status === "completed")
      || group[0];
    const completedProviders = [...new Set(group.filter((item) => item.status === "completed").map((item) => item.provider))];
    work.transcriptProviderLabel = completedProviders.length > 1 ? "双通道" : completedProviders[0] === "whisper" ? "Whisper" : completedProviders[0] === "getnotes" ? "云端" : job?.provider === "whisper" ? "Whisper" : job?.provider === "getnotes" ? "云端" : "";
    work.transcriptStatus = job?.status || ""; work.transcriptError = job?.error_message || "";
    work.transcript = job ? ({ completed: "已转写", running: "转写中", queued: "排队中", failed: "转写失败", partial: "部分转写" })[job.status] || "未转写" : "未转写";
  });
}
function transcriptSignature(jobs) { return JSON.stringify(jobs.map((job) => [job.id, job.status, job.updated_at, job.error_message])); }
async function refreshTranscriptStates() {
  if (!currentCrawlTaskId || !hasHydratedWorks) return;
  const response = await fetch(`/api/transcript-jobs?crawlTaskId=${encodeURIComponent(currentCrawlTaskId)}`); if (!response.ok) return;
  const { jobs } = await response.json(); const signature = transcriptSignature(jobs); if (signature === lastTranscriptSignature) return;
  lastTranscriptSignature = signature; applyTranscriptJobs(jobs); render();
}
async function loadWorksFromTask(taskId, source = "", status = "waiting_for_user") {
  const response = await fetch(`/api/tasks/${taskId}/works`); if (!response.ok) return;
  const payload = await response.json(); works = payload.works.map(mapWork); currentCrawlTaskId = taskId; currentCrawlStatus = status; selectedIds.clear(); currentPage = 1; hasHydratedWorks = true;
  workbenchView.classList.add("has-directory");
  const taskResponse = await fetch(`/api/tasks/${taskId}`);
  const task = taskResponse.ok ? await taskResponse.json() : null;
  const warningCount = Number(task?.summary?.warningCount || 0);
  const jobsResponse = await fetch(`/api/transcript-jobs?crawlTaskId=${encodeURIComponent(taskId)}`); if (jobsResponse.ok) { const { jobs } = await jobsResponse.json(); lastTranscriptSignature = transcriptSignature(jobs); applyTranscriptJobs(jobs); }
  const isFavorites = task?.source_mode === "favorites";
  creatorName.textContent = isFavorites ? "我的收藏夹" : works[0]?.authorNickname || "关注博主";
  creatorAvatar.innerHTML = avatarMarkup(isFavorites ? "" : works[0]?.authorAvatarUrl, isFavorites ? "藏" : creatorName.textContent.slice(0, 1), "creator-avatar-media");
  creatorMeta.textContent = status === "partial" ? `${source || "真实 JSON 目录"} · 待复核，后续处理已锁定` : warningCount ? `${source || "真实 JSON 目录"} · JSON 审核通过，${warningCount} 条警告` : `${source || "真实 JSON 目录"} · JSON 审核通过，可选择作品`;
  totalCount.textContent = formatNumber(works.length);
  videoCount.textContent = formatNumber(works.filter((work) => work.contentType === "视频").length);
  imageCount.textContent = formatNumber(works.filter((work) => work.contentType === "图文").length);
  auditStatus.textContent = status === "partial" ? "待复核" : warningCount ? `通过 · ${warningCount} 条警告` : "通过";
  if (status === "partial") {
    const pageTotal = task?.summary?.pageTotal ?? "未知";
    const missingDate = task?.summary?.missing?.date ?? task?.summary?.missing?.publishTimestamp ?? 0;
    directoryModeBanner.hidden = false;
    directoryModeBanner.className = "directory-mode-banner is-review";
    directoryModeBanner.innerHTML = `<div><span>只读复核模式</span><strong>${escapeHtml(creatorName.textContent)}</strong></div><p>已加载 <b>${formatNumber(works.length)}</b> 条作品；主页计数 <b>${escapeHtml(pageTotal)}</b> 条；发布日期缺失 <b>${formatNumber(missingDate)}</b> 条。你可以查看和筛选，但转写、拆解与蒸馏保持锁定。</p>`;
  } else if (warningCount) {
    directoryModeBanner.hidden = false;
    directoryModeBanner.className = "directory-mode-banner is-warning";
    directoryModeBanner.innerHTML = `<div><span>元数据警告</span><strong>${escapeHtml(creatorName.textContent)}</strong></div><p>已加载 <b>${formatNumber(works.length)}</b> 条作品；<b>${formatNumber(warningCount)}</b> 条缺少原始标题，现以作品类型和 ID 代替显示，不影响转写、拆解或蒸馏。</p>`;
  } else {
    directoryModeBanner.hidden = true;
    directoryModeBanner.className = "directory-mode-banner";
    directoryModeBanner.replaceChildren();
  }
  render();
}
async function loadRuntimeConfig() {
  try {
    const response = await fetch("/api/health"); const payload = await readApiPayload(response, "无法读取本地服务状态");
    if (response.ok && payload.assetRoot) { storageRoots.obsidian = payload.assetRoot; renderStorageLocation(); }
    if (response.ok && !payload.capabilities?.includes("viral-breakdown")) taskRuntimeStatus.textContent = "后端版本过旧，请重启自媒体工作台";
  } catch { /* 本地服务未启动时保留提示，不伪造路径。 */ }
}
function sourceProgressTask(tasks) {
  const currentTask = tasks.find((task) => task.id === activeSourceTaskId);
  if (currentTask) return currentTask;
  return tasks.find((task) => isDirectoryTask(task) && ["queued", "running"].includes(task.status))
    || tasks.find((task) => isGetNotesTask(task) && ["queued", "running"].includes(task.status))
    || tasks.find((task) => isDirectoryTask(task))
    || null;
}
function taskSourceKey(task) {
  if (task?.source_mode === "favorites") return `favorites:${task.profile_id || "favorites-default"}`;
  return `creator:${String(task?.source || "").trim().toLowerCase()}`;
}
function creatorArchiveEntries(tasks, runs, transcriptJobs, subscriptions) {
  const directoryTasks = tasks.filter((task) => isDirectoryTask(task) && !isFavoritesDiscoveryTask(task) && task.output_path && ["waiting_for_user", "partial"].includes(task.status));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const latestByKey = new Map();
  directoryTasks.forEach((task) => {
    const key = taskSourceKey(task); const current = latestByKey.get(key);
    if (!current || new Date(task.updated_at) > new Date(current.updated_at)) latestByKey.set(key, task);
  });
  return subscriptions.map((subscription) => {
    const latest = latestByKey.get(subscription.source_key) || null;
    const relatedRuns = runs.filter((run) => taskSourceKey(tasksById.get(run.task_id)) === subscription.source_key);
    const transcriptsByVideo = new Map();
    transcriptJobs.filter((job) => job.status === "completed" && taskSourceKey(tasksById.get(job.crawl_task_id)) === subscription.source_key).forEach((job) => {
      if (!transcriptsByVideo.has(String(job.video_id))) transcriptsByVideo.set(String(job.video_id), job);
    });
    const transcripts = [...transcriptsByVideo.values()];
    return { source: subscription.source_key, subscription, latest, runCount: relatedRuns.length, completedTranscripts: transcripts.length, relatedRuns, transcripts };
  }).sort((a, b) => Number(a.subscription.source_type === "favorites") - Number(b.subscription.source_type === "favorites") || new Date(b.subscription.updated_at) - new Date(a.subscription.updated_at));
}
function renderCreatorArchive(creators, force = false) {
  archiveCreators = creators;
  if (!creators.some((entry) => entry.source === selectedCreatorSource)) selectedCreatorSource = creators[0]?.source || "";
  const signature = JSON.stringify([selectedCreatorSource, creators.map((entry) => [entry.source, entry.subscription.updated_at, entry.subscription.enabled, entry.subscription.next_check_at, entry.latest?.updated_at, entry.runCount, entry.completedTranscripts])]);
  if (!force && signature === lastCreatorArchiveSignature) return;
  lastCreatorArchiveSignature = signature;
  const list = document.querySelector("#creator-archive-list"); const detail = document.querySelector("#creator-archive-detail");
  if (!creators.length) {
    list.innerHTML = '<p class="creator-rail-empty">暂无关注来源</p>';
    detail.innerHTML = '<div class="creator-archive-empty"><strong>还没有关注来源</strong><p>完成一次博主主页或收藏夹作品抓取后，会自动建立每日更新规则。</p><button class="outline-button" type="button" data-return-workbench>回到内容工作台</button></div>';
    return;
  }
  list.innerHTML = creators.map(({ source, subscription, latest }) => {
    const isFavorites = subscription.source_type === "favorites"; const creator = subscription.display_name || (isFavorites ? "我的收藏夹" : subscription.source); const active = source === selectedCreatorSource;
    return `<div class="creator-list-row"><button class="creator-list-button${active ? " is-active" : ""}" type="button" data-creator-select="${escapeHtml(source)}" aria-pressed="${active}">${avatarMarkup(isFavorites ? "" : latest?.creator_avatar_url, isFavorites ? "藏" : creator.slice(0, 1), "creator-list-avatar")}<span><strong>${escapeHtml(creator)}</strong><small>${isFavorites ? "我的收藏夹" : `博主 · ${escapeHtml(subscription.source)}`}</small></span><i class="${subscription.enabled ? "" : "is-paused"}"></i></button><button class="creator-remove-button" type="button" data-subscription-delete="${escapeHtml(subscription.id)}" aria-label="取消关注 ${escapeHtml(creator)}" title="取消关注，不删除历史资产">×</button></div>`;
  }).join("");
  const selected = creators.find((entry) => entry.source === selectedCreatorSource) || creators[0];
  const { source, subscription, latest, runCount, completedTranscripts, relatedRuns, transcripts } = selected;
  const isFavorites = subscription.source_type === "favorites"; const creator = subscription.display_name || (isFavorites ? "我的收藏夹" : subscription.source); const isReview = latest?.status === "partial"; const total = Number(latest?.summary?.totalCount || subscription.lastResult?.totalCount || 0); const warningCount = Number(latest?.summary?.warningCount || 0);
  const recentRuns = relatedRuns.slice(0, 5).map((run) => `<div class="creator-run-item"><span>${formatTime(run.created_at)}</span><strong>${formatNumber(run.total_count)} 条</strong><small class="${run.audit_status === "passed" ? "is-ready" : "is-review"}">${run.audit_status === "passed" ? "审核通过" : "待复核"}</small></div>`).join("") || '<p class="creator-detail-empty">暂无历史抓取记录</p>';
  const transcriptItems = transcripts.slice(0, 8).map((job) => `<div class="creator-transcript-item"><div><strong>${escapeHtml(job.title || `作品 ${job.video_id}`)}</strong><small>${escapeHtml(job.video_id)} · ${formatTime(job.updated_at)}</small></div><button type="button" data-creator-transcript-folder="${escapeHtml(job.task_id)}">打开文件夹</button></div>`).join("") || '<p class="creator-detail-empty">该来源暂无已完成转写</p>';
  const intervalOptions = [[360, "每 6 小时"], [720, "每 12 小时"], [1440, "每天"], [10080, "每周"]].map(([minutes, label]) => `<option value="${minutes}"${Number(subscription.check_interval_minutes) === minutes ? " selected" : ""}>${label}</option>`).join("");
  const result = subscription.lastResult ? `上次发现新增 ${formatNumber(subscription.lastResult.newCount || 0)} 条，当前 ${formatNumber(subscription.lastResult.totalCount || 0)} 条` : "尚未完成自动增量检查";
  detail.innerHTML = `<div class="creator-detail-hero"><div class="creator-detail-identity">${avatarMarkup(isFavorites ? "" : latest?.creator_avatar_url, isFavorites ? "藏" : creator.slice(0, 1), "creator-detail-avatar")}<div><small>${isFavorites ? "我的收藏夹" : "关注博主"}</small><h2>${escapeHtml(creator)}</h2><code>${isFavorites ? `收藏夹账号 · ${escapeHtml(subscription.profile_id || "-")}` : `抖音号 ${escapeHtml(subscription.source)}`}</code></div></div><div class="creator-detail-actions"><span class="task-status ${subscription.enabled ? "ready" : "queued"}">${subscription.enabled ? "定期检查已开启" : "定期检查已暂停"}</span>${latest ? `<button class="primary-button" type="button" data-creator-open="${escapeHtml(latest.id)}" data-creator-status="${escapeHtml(latest.status)}" data-creator-source="${escapeHtml(subscription.source)}">${isReview ? "查看待复核目录" : "打开作品目录"}</button>` : ""}</div></div><section class="subscription-control"><div><span>更新频率</span><select data-subscription-interval="${escapeHtml(subscription.id)}">${intervalOptions}</select></div><div><span>下次检查</span><strong>${subscription.enabled ? formatTime(subscription.next_check_at) : "已暂停"}</strong></div><div><span>最近结果</span><strong>${escapeHtml(subscription.last_error || result)}</strong></div><div class="subscription-actions"><button class="outline-button" type="button" data-subscription-check="${escapeHtml(subscription.id)}">立即检查</button><button class="text-button" type="button" data-subscription-toggle="${escapeHtml(subscription.id)}" data-enabled="${subscription.enabled}">${subscription.enabled ? "暂停更新" : "恢复更新"}</button><button class="text-button danger" type="button" data-subscription-delete="${escapeHtml(subscription.id)}">取消关注</button></div></section><div class="creator-detail-stats"><article><span>最新目录</span><strong>${formatNumber(total)}</strong><small>条作品</small></article><article><span>抓取归档</span><strong>${formatNumber(runCount)}</strong><small>次记录</small></article><article><span>完成转写</span><strong>${formatNumber(completedTranscripts)}</strong><small>条文本</small></article></div><div class="creator-detail-grid"><section><div class="creator-detail-heading"><span>最新资产</span><small>${formatTime(latest?.updated_at)}</small></div><dl class="creator-asset-meta"><div><dt>JSON 审核</dt><dd>${!latest ? "暂无目录" : isReview ? "待复核" : warningCount ? `通过（${warningCount} 条警告）` : "通过"}</dd></div><div><dt>目录规模</dt><dd>${formatNumber(total)} 条</dd></div><div><dt>本地文件</dt><dd title="${escapeHtml(latest?.output_path || subscription.baseline_output_path || "")}">${escapeHtml(latest?.output_path || subscription.baseline_output_path || "尚未生成")}</dd></div></dl></section><section><div class="creator-detail-heading"><span>最近抓取</span><small>最近 5 次</small></div><div class="creator-run-list">${recentRuns}</div></section><section class="creator-transcript-section"><div class="creator-detail-heading"><span>已转写作品</span><small>共 ${formatNumber(completedTranscripts)} 条，显示最近 8 条</small></div><div class="creator-transcript-list">${transcriptItems}</div></section></div><p id="archive-storage-note" class="creator-detail-root">知识资产根目录：<code data-asset-root>${escapeHtml(storageRoots[storageMode])}</code></p>`;
}
function taskAccountContext(task) {
  if (!task.account_role && !task.profile_id) return "";
  const role = task.account_role === "favorites" ? "收藏夹账号" : "内容采集账号";
  return `${role}${task.profile_id ? ` · Profile ${task.profile_id}` : ""}`;
}
async function refreshRuntimeViews() {
  try {
    const [tasksResponse, runsResponse, transcriptsResponse, subscriptionsResponse] = await Promise.all([fetch("/api/tasks"), fetch("/api/runs"), fetch("/api/transcript-jobs"), fetch("/api/subscriptions")]);
    if (!tasksResponse.ok || !runsResponse.ok || !transcriptsResponse.ok || !subscriptionsResponse.ok) return;
    const { tasks } = await tasksResponse.json(); const { runs } = await runsResponse.json(); const { jobs: transcriptJobs } = await transcriptsResponse.json(); const { subscriptions } = await subscriptionsResponse.json(); latestTasksById = new Map(tasks.map((task) => [task.id, task]));
    if (!hasHydratedWorks) {
      const latestReadyTask = tasks.find((task) => isDirectoryTask(task) && !isFavoritesDiscoveryTask(task) && ["waiting_for_user", "partial"].includes(task.status) && task.output_path);
      if (latestReadyTask) loadWorksFromTask(latestReadyTask.id, latestReadyTask.source, latestReadyTask.status);
    }
    renderSourceProgress(sourceProgressTask(tasks));
    await refreshTranscriptStates();
    await refreshViralReports();
    const active = tasks.filter((task) => ["queued", "running", "waiting_for_action", "waiting_for_user", "partial", "failed", "interrupted_recoverable"].includes(task.status));
    const visibleTasks = active.filter((task) => matchesTaskFilter(task, taskStatusFilter) && matchesTaskType(task, taskTypeFilter));
    const taskCard = document.querySelector(".active-task-list"); const taskSummary = document.querySelector(".task-summary");
    taskCard.querySelectorAll("details[open][data-task-log]").forEach((details) => openTaskLogs.add(details.dataset.taskLog));
    taskRuntimeStatus.textContent = tasks.some((task) => ["queued", "running"].includes(task.status)) ? "本地任务正在执行" : "本地任务状态已同步";
    const statusFilters = [["", "全部"], ["active", "进行中"], ["action", "需处理"], ["review", "待复核"], ["failed", "失败"], ["ready", "产物就绪"]];
    const typeFilters = [["", "全部类型"], ["directory", "目录抓取"], ["transcription", "文本转写"], ["analysis", "内容分析"]];
    taskSummary.innerHTML = `<div class="task-status-filters">${statusFilters.map(([filter, label]) => `<button type="button" class="task-summary-card${taskStatusFilter === filter ? " is-active" : ""}" data-task-status-filter="${filter}" aria-pressed="${taskStatusFilter === filter}"><span>${label}</span><strong>${active.filter((task) => matchesTaskFilter(task, filter)).length}</strong></button>`).join("")}</div><div class="task-type-filters"><span>任务类型</span>${typeFilters.map(([filter, label]) => `<button type="button" class="${taskTypeFilter === filter ? "is-active" : ""}" data-task-type-filter="${filter}">${label}</button>`).join("")}</div>`;
    const taskRows = visibleTasks.map((task) => {
      const progress = task.progress || {};
      const getNotesTask = isGetNotesTask(task);
      const viralTask = isViralTask(task);
      const intelligenceTask = isContentIntelligenceTask(task);
      const analysisTask = viralTask || intelligenceTask;
      const summary = task.summary || {};
      const inferredCompletedCount = isDirectoryTask(task) && task.status === "waiting_for_user" ? Number(summary.totalCount || 0) : 0;
      const discovered = progress.discovered ?? (inferredCompletedCount || null); const expectedTotal = progress.expectedTotal ?? (inferredCompletedCount || null);
      const countText = task.status === "waiting_for_action" ? "已暂停，不再继续请求" : analysisTask ? task.status === "waiting_for_user" ? `产物完成 · ${summary.totalCount || 0} 条证据` : task.status === "failed" ? "分析产物未生成" : `${summary.totalCount || 0} 条证据处理中` : getNotesTask ? `完成 ${summary.completed || 0} / ${summary.totalCount || 0} 条${summary.failed ? `，失败 ${summary.failed} 条` : ""}` : discovered != null ? `${discovered}${expectedTotal ? ` / ${expectedTotal}` : ""} 条` : summary.totalCount ? `${summary.totalCount} 条` : "尚未收到进度";
      const log = taskLogTail(task);
      const events = (task.progressHistory || []).slice(-4);
      const analysisProgress = ({ queued: 6, loading_evidence: 28, requesting_model: 68, completed: 100 })[progress.stage || task.status] || 0;
      const transcriptTotal = Number(summary.totalCount || 0);
      const transcriptProcessed = Number(summary.completed || 0) + Number(summary.failed || 0);
      const transcriptionProgress = transcriptTotal ? Math.min(100, Math.round(transcriptProcessed / transcriptTotal * 100)) : 0;
      const progressWidth = analysisTask ? analysisProgress : getNotesTask ? transcriptionProgress : expectedTotal && discovered != null ? Math.min(100, Math.round(discovered / expectedTotal * 100)) : 0;
      const progressClass = task.status === "waiting_for_user" ? " is-complete" : task.status === "partial" ? " is-partial" : "";
      const logOpen = openTaskLogs.has(task.id) ? " open" : "";
      const favoritesDiscovery = isFavoritesDiscoveryTask(task);
      const intelligenceAction = intelligenceTask && task.status === "waiting_for_user" ? `<button type="button" data-task-open-intelligence="${escapeHtml(summary.provider || "")}" data-artifact-id="${escapeHtml(summary.batchId || summary.agentId || summary.reviewId || "")}">查看产物</button>` : "";
      const actions = viralTask ? task.status === "waiting_for_user" ? `<button type="button" data-task-open-report="${escapeHtml(summary.reportId || "")}">查看报告</button><button type="button" data-task-rerun-analysis="${escapeHtml(task.id)}">重新拆解</button>` : task.status === "failed" || task.status === "interrupted_recoverable" ? `<button type="button" data-task-rerun-analysis="${escapeHtml(task.id)}">重新拆解</button>` : "" : intelligenceTask ? intelligenceAction : getNotesTask ? task.status === "waiting_for_user" ? `<button type="button" data-task-open-transcripts="${escapeHtml(task.id)}">打开转写文件夹</button>` : "" : task.status === "waiting_for_action" ? `<button type="button" data-task-account-settings>处理账号问题</button><button type="button" data-task-refetch="${escapeHtml(task.source)}">回工作台</button>` : favoritesDiscovery && task.status === "waiting_for_user" ? `<button type="button" data-task-favorites-choose="${escapeHtml(task.id)}">选择收藏夹</button>` : task.status === "partial" ? `<button type="button" data-task-reaudit="${escapeHtml(task.id)}">重新审核 JSON</button><button type="button" data-task-open="${escapeHtml(task.id)}" data-task-status="${escapeHtml(task.status)}" data-task-source="${escapeHtml(task.source)}">查看待复核目录</button><button type="button" data-task-refetch="${escapeHtml(task.source)}">重新抓取</button>` : task.status === "waiting_for_user" ? `<button type="button" data-task-open="${escapeHtml(task.id)}" data-task-status="${escapeHtml(task.status)}" data-task-source="${escapeHtml(task.source)}">打开作品目录</button>` : task.status === "failed" || task.status === "interrupted_recoverable" ? `<button type="button" data-task-refetch="${escapeHtml(task.source)}">回工作台重试</button>` : "";
      const logName = analysisTask ? "分析" : getNotesTask ? "转写" : "抓取";
      const accountContext = taskAccountContext(task);
      const loopLabel = loopAttemptLabel(task);
      return `<div class="task-row"><div class="task-title"><span class="task-kind">${taskKind(task)}</span><div class="task-identity"><strong>${escapeHtml(taskDisplayName(task))}</strong><code>${escapeHtml(task.source)}</code></div><small>${escapeHtml(progressText(task))}</small>${loopLabel ? `<small class="task-loop-label">${escapeHtml(loopLabel)}</small>` : ""}${accountContext ? `<small>${escapeHtml(accountContext)}</small>` : ""}</div><div class="task-context"><span>${escapeHtml(auditDetail(task))}</span><small>开始于 ${formatTime(task.created_at)} · 最近更新 ${formatTime(task.updated_at)}</small>${events.length ? `<div class="task-events">${events.map((event) => `<span>${escapeHtml(event.label || event.stage || "处理中")}</span>`).join("")}</div>` : ""}${log ? `<details class="task-log" data-task-log="${escapeHtml(task.id)}"${logOpen}><summary>查看${logName}日志（最近 20 条）</summary><pre>${escapeHtml(log)}</pre></details>` : ""}</div><div class="task-progress${progressClass}"><span>${progressWidth ? `<i style="width:${progressWidth}%"></i>` : ""}</span><b>${countText}</b></div><div class="task-tail"><div class="task-status ${taskClass(task.status)}">${taskStatusLabel(task)}</div>${actions ? `<div class="task-inline-actions">${actions}</div>` : ""}</div></div>`;
    }).join("") || `<p class="task-center-note">当前没有需要处理的任务。</p>`;
    const taskRenderSignature = JSON.stringify([taskStatusFilter, taskTypeFilter, visibleTasks.map((task) => [task.id, task.status, task.updated_at, task.creator_name, task.progress_json, task.summary_json, task.options_json])]);
    if (taskRenderSignature !== lastTaskRenderSignature) {
      const filterLabel = taskStatusFilter ? taskFilterLabel(taskStatusFilter) : "全部";
      const typeLabel = ({ directory: "目录抓取", transcription: "文本转写", analysis: "内容分析" })[taskTypeFilter] || "全部类型";
      taskCard.innerHTML = `<div class="card-heading"><div><span class="section-label"><i></i>真实任务</span><h2>任务执行与结果</h2></div><small>当前展示：${escapeHtml(filterLabel)} · ${escapeHtml(typeLabel)}</small></div>${taskRows}<p id="task-center-note" class="task-center-note">上方状态和任务类型均可筛选；数据每 2 秒同步一次。</p>`;
      lastTaskRenderSignature = taskRenderSignature;
    }
    const creators = creatorArchiveEntries(tasks, runs, transcriptJobs, subscriptions); const archivedWorkCount = creators.reduce((total, entry) => total + Number(entry.latest?.summary?.totalCount || 0), 0); const archivedTranscriptCount = creators.reduce((total, entry) => total + entry.completedTranscripts, 0);
    document.querySelector("#archived-creator-count").textContent = formatNumber(creators.length); document.querySelector("#archived-run-count").textContent = formatNumber(runs.length); document.querySelector("#archived-work-count").textContent = formatNumber(archivedWorkCount); document.querySelector("#archived-transcript-count").textContent = formatNumber(archivedTranscriptCount); document.querySelector("#creator-archive-status").textContent = creators.length ? `已同步 ${creators.length} 个关注来源` : "暂无关注来源";
    renderCreatorArchive(creators);
    if (!document.querySelector("#topics-view").hidden) await refreshTopicAdvisor();
    if (!document.querySelector("#agent-view").hidden) await refreshAgentWorkbench();
  } catch { /* 服务不可用时保留页面结构，不把演示数据伪装为真实数据。 */ }
}
async function reauditTask(taskId) {
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/re-audit`, { method: "POST" });
    const task = await response.json();
    if (!response.ok) throw new Error(task.error || "重新审核失败");
    activeSourceTaskId = task.id;
    await loadWorksFromTask(task.id, task.source, task.status);
    await refreshRuntimeViews();
    showToast(task.status === "waiting_for_user" ? `现有 JSON 已重新审核，可继续处理；${task.summary?.warningCount || 0} 条元数据警告已保留。` : "重新审核完成，仍存在阻断问题，请查看待复核说明。", task.status === "waiting_for_user" ? "success" : "review");
  } catch (error) { showToast(`重新审核失败：${scrubProviderName(error.message)}`, "review"); }
}
document.querySelector(".active-task-list").addEventListener("toggle", (event) => {
  if (!(event.target instanceof HTMLDetailsElement) || !event.target.matches("[data-task-log]")) return;
  const taskId = event.target.dataset.taskLog;
  if (event.target.open) openTaskLogs.add(taskId); else openTaskLogs.delete(taskId);
}, true);
sourceProgress.addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-source-open]");
  const refetchButton = event.target.closest("[data-source-refetch]");
  const reauditButton = event.target.closest("[data-source-reaudit]");
  const chooseButton = event.target.closest("[data-favorites-choose]");
  const accountButton = event.target.closest("[data-source-account-settings]");
  if (openButton) await showTaskDirectory(openButton.dataset.sourceOpen, openButton.dataset.sourceStatus, openButton.dataset.sourceValue);
  if (refetchButton) prepareTaskRefetch(refetchButton.dataset.sourceRefetch);
  if (reauditButton) await reauditTask(reauditButton.dataset.sourceReaudit);
  if (chooseButton) { const task = latestTasksById.get(chooseButton.dataset.favoritesChoose); if (task) await openFavoritesCollections(task); }
  if (accountButton) {
    setActiveView("settings");
    document.querySelector("#account-profiles-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
});
document.querySelector(".active-task-list").addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-task-open]");
  const favoritesChooseButton = event.target.closest("[data-task-favorites-choose]");
  const refetchButton = event.target.closest("[data-task-refetch]");
  const transcriptsButton = event.target.closest("[data-task-open-transcripts]");
  const reportButton = event.target.closest("[data-task-open-report]");
  const intelligenceButton = event.target.closest("[data-task-open-intelligence]");
  const rerunButton = event.target.closest("[data-task-rerun-analysis]");
  const reauditButton = event.target.closest("[data-task-reaudit]");
  const accountButton = event.target.closest("[data-task-account-settings]");
  if (favoritesChooseButton) { const task = latestTasksById.get(favoritesChooseButton.dataset.taskFavoritesChoose); if (task) await openFavoritesCollections(task); }
  if (openButton) await showTaskDirectory(openButton.dataset.taskOpen, openButton.dataset.taskStatus, openButton.dataset.taskSource);
  if (refetchButton) prepareTaskRefetch(refetchButton.dataset.taskRefetch);
  if (reportButton?.dataset.taskOpenReport) { try { await loadViralReport(reportButton.dataset.taskOpenReport); } catch (error) { showToast(scrubProviderName(error.message), "review"); } }
  if (intelligenceButton) {
    const provider = intelligenceButton.dataset.taskOpenIntelligence;
    if (provider === "topic-advisor") {
      activeTopicBatchId = intelligenceButton.dataset.artifactId;
      lastTopicSignature = "";
      setActiveView("topics");
    } else {
      if (provider === "creator-agent") activeCreatorAgentId = intelligenceButton.dataset.artifactId;
      lastAgentSignature = "";
      setActiveView("agent");
    }
  }
  if (rerunButton) { const task = latestTasksById.get(rerunButton.dataset.taskRerunAnalysis); if (task?.summary?.crawlTaskId && task.summary?.workIds?.length) await submitBreakdown(task.summary.crawlTaskId, task.summary.workIds); }
  if (reauditButton) await reauditTask(reauditButton.dataset.taskReaudit);
  if (accountButton) {
    setActiveView("settings");
    document.querySelector("#account-profiles-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  if (transcriptsButton) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(transcriptsButton.dataset.taskOpenTranscripts)}/open-transcript-folder`, { method: "POST" }); const payload = await response.json();
      showToast(response.ok ? "已打开转写文件所在文件夹。" : payload.error || "无法打开转写文件夹。", response.ok ? "success" : "review");
    } catch (error) { showToast(`无法打开转写文件夹：${scrubProviderName(error.message)}`, "review"); }
  }
});
document.querySelector("#breakdown-view").addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-report-open]");
  const folderButton = event.target.closest("[data-report-folder]");
  const rerunButton = event.target.closest("[data-report-rerun]");
  if (openButton) { try { await loadViralReport(openButton.dataset.reportOpen); } catch (error) { showToast(scrubProviderName(error.message), "review"); } }
  if (folderButton) {
    try { const response = await fetch(`/api/viral-reports/${encodeURIComponent(folderButton.dataset.reportFolder)}/open-folder`, { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法打开报告文件夹"); showToast("已打开爆款拆解报告文件夹。", "success"); } catch (error) { showToast(scrubProviderName(error.message), "review"); }
  }
  if (rerunButton) { const report = viralReportsById.get(rerunButton.dataset.reportRerun); if (report?.crawl_task_id && report.workIds?.length) await submitBreakdown(report.crawl_task_id, report.workIds); }
});
openBreakdownFolder.addEventListener("click", async () => {
  if (!activeBreakdownReportId) return;
  try { const response = await fetch(`/api/viral-reports/${encodeURIComponent(activeBreakdownReportId)}/open-folder`, { method: "POST" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || "无法打开报告文件夹"); showToast("已打开爆款拆解报告文件夹。", "success"); } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
useBreakdownForTopics.addEventListener("click", () => {
  if (!activeBreakdownReportId) return;
  selectedTopicReportIds = new Set([activeBreakdownReportId]);
  activeTopicBatchId = "";
  lastTopicSignature = "";
  setActiveView("topics");
});
topicSourceList.addEventListener("change", (event) => {
  const input = event.target.closest("[data-topic-report]");
  if (!input) return;
  if (input.checked) {
    if (!topicComparisonMode) {
      selectedTopicReportIds = new Set([...selectedTopicReportIds].filter((id) => {
        const report = topicReportsById.get(id);
        return String(report?.douyin_id || report?.creator_name || "unknown") === input.dataset.topicCreator;
      }));
    }
    selectedTopicReportIds.add(input.value);
  }
  else selectedTopicReportIds.delete(input.value);
  lastTopicSignature = "";
  refreshTopicAdvisor(true);
});
document.querySelector("#select-all-topic-reports").addEventListener("click", () => {
  const inputs = [...topicSourceList.querySelectorAll("[data-topic-report]")];
  const firstSelected = inputs.find((input) => input.checked) || inputs[0];
  const selectable = topicComparisonMode || !firstSelected ? inputs : inputs.filter((input) => input.dataset.topicCreator === firstSelected.dataset.topicCreator);
  const shouldSelectAll = selectable.some((input) => !input.checked);
  selectedTopicReportIds = new Set(shouldSelectAll ? selectable.map((input) => input.value) : []);
  lastTopicSignature = "";
  refreshTopicAdvisor(true);
});
topicComparisonModeInput.addEventListener("change", () => {
  topicComparisonMode = topicComparisonModeInput.checked;
  if (!topicComparisonMode && selectedTopicReportIds.size) {
    const firstReport = topicReportsById.get([...selectedTopicReportIds][0]);
    const firstCreator = String(firstReport?.douyin_id || firstReport?.creator_name || "unknown");
    selectedTopicReportIds = new Set([...selectedTopicReportIds].filter((id) => {
      const report = topicReportsById.get(id);
      return String(report?.douyin_id || report?.creator_name || "unknown") === firstCreator;
    }));
    showToast("已关闭跨博主对比，只保留当前博主的爆款报告。", "success");
  }
  lastTopicSignature = "";
  refreshTopicAdvisor(true);
});
generateTopics.addEventListener("click", async () => {
  if (!selectedTopicReportIds.size) return;
  const count = Number(document.querySelector("#topic-generation-count").value) || 12;
  if (!window.confirm(`将读取 ${selectedTopicReportIds.size} 份已完成的爆款拆解报告${topicComparisonMode ? "，按跨博主对比模式" : ""}生成 ${count} 个带证据选题。是否继续？`)) return;
  generateTopics.disabled = true;
  try {
    const response = await fetch("/api/topic-batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reportIds: [...selectedTopicReportIds], count, comparisonMode: topicComparisonMode }) });
    const payload = await readApiPayload(response, "创建选题任务失败");
    activeTopicBatchId = payload.batchId;
    lastTopicSignature = "";
    showToast("选题任务已进入本地分析队列。", "success");
    await refreshTopicAdvisor(true);
    await refreshRuntimeViews();
  } catch (error) {
    showToast(`选题任务创建失败：${scrubProviderName(error.message)}`, "review");
  }
});
topicBatchHistory.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-topic-batch-open]");
  if (!button) return;
  activeTopicBatchId = button.dataset.topicBatchOpen;
  try {
    const response = await fetch(`/api/topic-batches/${encodeURIComponent(activeTopicBatchId)}`);
    const batch = await readApiPayload(response, "读取选题批次失败");
    renderTopicBatch(batch);
    lastTopicSignature = "";
    await refreshTopicAdvisor(true);
  } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
openTopicFolder.addEventListener("click", async () => {
  const batchId = openTopicFolder.dataset.batchId;
  if (!batchId) return;
  try {
    const response = await fetch(`/api/topic-batches/${encodeURIComponent(batchId)}/open-folder`, { method: "POST" });
    await readApiPayload(response, "无法打开选题文件夹");
    showToast("已打开选题资产文件夹。", "success");
  } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
agentCreatorList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-agent-creator]");
  if (!button) return;
  selectedAgentCreator = button.dataset.agentCreator;
  lastAgentSignature = "";
  refreshAgentWorkbench(true);
});
generateCreatorAgent.addEventListener("click", async () => {
  if (!selectedAgentCreator) return;
  if (activeCreatorAgentStatus === "completed") {
    creatorAgentProfile.scrollIntoView({ block: "center", behavior: "smooth" });
    showToast("当前智能体已生成。可查看画像、打开资产文件夹，或在下方粘贴稿件开始审阅。", "success");
    return;
  }
  if (!window.confirm("将读取该博主现有的已转写材料并调用项目分析模型。生成结果是可审计的内容画像，不代表博主本人。是否继续？")) return;
  generateCreatorAgent.disabled = true;
  try {
    const response = await fetch("/api/creator-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ douyinId: selectedAgentCreator }) });
    const payload = await readApiPayload(response, "创建博主智能体失败");
    activeCreatorAgentId = payload.agentId;
    lastAgentSignature = "";
    showToast("博主智能体任务已进入本地分析队列。", "success");
    await refreshAgentWorkbench(true);
    await refreshRuntimeViews();
  } catch (error) { showToast(`创建博主智能体失败：${scrubProviderName(error.message)}`, "review"); }
});
openAgentFolder.addEventListener("click", async () => {
  const agentId = openAgentFolder.dataset.agentId;
  if (!agentId) return;
  try {
    const response = await fetch(`/api/creator-agents/${encodeURIComponent(agentId)}/open-folder`, { method: "POST" });
    await readApiPayload(response, "无法打开智能体文件夹");
    showToast("已打开博主智能体资产文件夹。", "success");
  } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
reviewDraft.addEventListener("click", async () => {
  const draft = draftReviewInput.value.trim();
  if (!activeCreatorAgentId) { showToast("请先生成一份博主智能体画像。", "review"); return; }
  if (draft.length < 20) { showToast("请粘贴至少 20 字的待审稿件。", "review"); return; }
  if (!window.confirm("智能体将读取已生成的博主画像和这篇稿件，输出带证据边界的修改建议。是否继续？")) return;
  reviewDraft.disabled = true;
  draftReviewState.textContent = "正在创建审稿任务...";
  try {
    const response = await fetch(`/api/creator-agents/${encodeURIComponent(activeCreatorAgentId)}/reviews`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft }) });
    await readApiPayload(response, "创建审稿任务失败");
    showToast("稿件已交给博主智能体审阅。", "success");
    lastAgentSignature = "";
    await refreshAgentWorkbench(true);
    await refreshRuntimeViews();
  } catch (error) {
    draftReviewState.textContent = `审稿任务失败：${scrubProviderName(error.message)}`;
    showToast(scrubProviderName(error.message), "review");
  }
});
document.querySelector("#archive-view").addEventListener("click", async (event) => {
  const openButton = event.target.closest("[data-creator-open]");
  const selectButton = event.target.closest("[data-creator-select]");
  const transcriptButton = event.target.closest("[data-creator-transcript-folder]");
  const checkButton = event.target.closest("[data-subscription-check]");
  const toggleButton = event.target.closest("[data-subscription-toggle]");
  const deleteButton = event.target.closest("[data-subscription-delete]");
  if (selectButton) { selectedCreatorSource = selectButton.dataset.creatorSelect; renderCreatorArchive(archiveCreators, true); }
  if (openButton) await showTaskDirectory(openButton.dataset.creatorOpen, openButton.dataset.creatorStatus, openButton.dataset.creatorSource);
  if (checkButton) {
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(checkButton.dataset.subscriptionCheck)}/check`, { method: "POST" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法创建增量检查任务");
      activeSourceTaskId = payload.taskId;
      showToast("增量检查已进入串行队列；只更新目录，不会自动转写或分析。", "success");
      setActiveView("tasks");
      await refreshRuntimeViews();
    } catch (error) { showToast(scrubProviderName(error.message), "review"); }
  }
  if (toggleButton) {
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(toggleButton.dataset.subscriptionToggle)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: toggleButton.dataset.enabled !== "true" }) }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法更新关注规则");
      showToast(payload.enabled ? "已恢复定期更新。" : "已暂停定期更新，历史资产不受影响。", "success");
      lastCreatorArchiveSignature = "";
      await refreshRuntimeViews();
    } catch (error) { showToast(scrubProviderName(error.message), "review"); }
  }
  if (deleteButton) {
    const entry = archiveCreators.find((item) => item.subscription.id === deleteButton.dataset.subscriptionDelete);
    const label = entry?.subscription.display_name || "该来源";
    if (!window.confirm(`取消关注“${label}”？只删除定期更新规则，已有 JSON、转写和分析资产会继续保留。`)) return;
    try {
      const response = await fetch(`/api/subscriptions/${encodeURIComponent(deleteButton.dataset.subscriptionDelete)}`, { method: "DELETE" }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "无法取消关注");
      selectedCreatorSource = "";
      lastCreatorArchiveSignature = "";
      showToast(`已取消关注“${label}”，历史资产已保留。`, "success");
      await refreshRuntimeViews();
    } catch (error) { showToast(scrubProviderName(error.message), "review"); }
  }
  if (transcriptButton) {
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(transcriptButton.dataset.creatorTranscriptFolder)}/open-transcript-folder`, { method: "POST" }); const payload = await response.json();
      showToast(response.ok ? "已打开该作品的转写文件夹。" : payload.error || "无法打开转写文件夹。", response.ok ? "success" : "review");
    } catch (error) { showToast(`无法打开转写文件夹：${scrubProviderName(error.message)}`, "review"); }
  }
  if (event.target.closest("[data-return-workbench]")) setActiveView("workbench");
});
document.querySelector("#archive-view").addEventListener("change", async (event) => {
  const intervalSelect = event.target.closest("[data-subscription-interval]");
  if (!intervalSelect) return;
  try {
    const response = await fetch(`/api/subscriptions/${encodeURIComponent(intervalSelect.dataset.subscriptionInterval)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ check_interval_minutes: Number(intervalSelect.value) }) }); const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "无法更新检查频率");
    showToast("检查频率已更新，下次执行时间已重新计算。", "success");
    lastCreatorArchiveSignature = "";
    await refreshRuntimeViews();
  } catch (error) { showToast(scrubProviderName(error.message), "review"); }
});
document.querySelector(".task-summary").addEventListener("click", (event) => {
  const card = event.target.closest("[data-task-status-filter]");
  const typeButton = event.target.closest("[data-task-type-filter]");
  if (card) taskStatusFilter = taskStatusFilter === card.dataset.taskStatusFilter ? "" : card.dataset.taskStatusFilter;
  if (typeButton) taskTypeFilter = taskTypeFilter === typeButton.dataset.taskTypeFilter ? "" : typeButton.dataset.taskTypeFilter;
  if (!card && !typeButton) return;
  lastTaskRenderSignature = "";
  refreshRuntimeViews();
});
document.querySelectorAll(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.view)));
document.querySelectorAll("[data-return-workbench]").forEach((button) => button.addEventListener("click", () => setActiveView("workbench")));
document.querySelectorAll("[data-open-storage]").forEach((button) => button.addEventListener("click", () => setActiveView("storage")));
document.querySelectorAll("[data-open-settings]").forEach((button) => button.addEventListener("click", () => setActiveView("settings")));
document.querySelector(".account-card")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  setActiveView("settings");
});
document.querySelector("#manage-accounts")?.addEventListener("click", () => {
  setActiveView("settings");
  document.querySelector("#account-profiles-form")?.scrollIntoView({ block: "start", behavior: "smooth" });
});
document.querySelectorAll("[data-storage-mode]").forEach((button) => button.addEventListener("click", () => { storageMode = button.dataset.storageMode; renderStorageLocation(); document.querySelector("#storage-note").textContent = `演示：已切换为${storageMode === "obsidian" ? "Obsidian 库" : "本地文件夹"}。真实产品会在写入或迁移前要求你选择并确认目录。`; }));
document.querySelectorAll("[data-storage-action]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#archive-storage-note").textContent = `演示：已选择“${button.dataset.storageAction}”。真实产品会在确认后打开当前资产根目录下的对应文件，不会由页面直接写入文件。`; }));
document.querySelectorAll(".check-follow").forEach((button) => button.addEventListener("click", () => { document.querySelector("#follow-note").textContent = "演示：已创建“立即检查”草稿。真实产品会先显示抓取范围与影响，确认后才进入串行队列。"; }));
document.querySelectorAll(".pause-follow").forEach((button) => button.addEventListener("click", () => { const isPaused = button.textContent === "恢复"; button.textContent = isPaused ? "暂停" : "恢复"; document.querySelector("#follow-note").textContent = isPaused ? "演示：该关注规则已恢复。定时检查尚未接入真实执行器。" : "演示：该关注规则已暂停，不会创建新的检查任务。"; }));
document.querySelector("#add-follow-demo")?.addEventListener("click", () => { document.querySelector("#follow-note").textContent = "演示：真实产品会在已有成功抓取基线后，要求确认来源范围和检查频率，再创建关注规则。"; });
document.querySelectorAll("[data-task-action]").forEach((button) => button.addEventListener("click", () => { document.querySelector("#task-center-note").textContent = `演示：已选择“${button.dataset.taskAction}”。真实产品会打开任务详情或确认步骤，不会由页面直接执行外部命令。`; }));

function formatRuntimeSize(bytes) {
  return bytes ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : "未安装";
}
function accountStatusLabel(status) {
  if (status?.ready) return "登录状态已验证";
  if (["launching_login", "waiting_for_login"].includes(status?.phase)) return "等待你在浏览器登录";
  if (status?.phase === "browser_closed") return "登录窗口已关闭";
  if (status?.phase === "helper_timeout") return "登录验证已超时";
  if (status?.phase === "helper_error") return "登录验证异常";
  return "尚未验证登录状态";
}
function accountStatusTime(status) {
  const value = status?.verifiedAt || status?.updatedAt;
  return value ? `最近检查 ${new Date(value).toLocaleString("zh-CN", { hour12: false })}` : "尚无验证记录";
}
function renderAccountProfiles(settings) {
  const signature = JSON.stringify(settings);
  if (signature === lastAccountProfileSignature) return;
  lastAccountProfileSignature = signature;
  const content = settings.roles?.content || {};
  const favorites = settings.roles?.favorites || {};
  const shared = settings.favoritesBinding === "shared";
  const readyState = {
    content: content.status?.ready === true,
    favorites: favorites.status?.ready === true,
  };
  const bindingInput = document.querySelector(`input[name="favorites-binding"][value="${shared ? "shared" : "independent"}"]`);
  if (bindingInput) bindingInput.checked = true;
  document.querySelector("#content-account-state").textContent = accountStatusLabel(content.status);
  document.querySelector("#content-account-meta").textContent = `Profile ${content.effectiveProfileId || "-"} · ${accountStatusTime(content.status)}`;
  document.querySelector("#favorites-account-state").textContent = shared ? `共用采集账号 · ${accountStatusLabel(favorites.status)}` : accountStatusLabel(favorites.status);
  document.querySelector("#favorites-account-meta").textContent = shared ? `复用 Profile ${favorites.effectiveProfileId || "-"}` : `Profile ${favorites.effectiveProfileId || "-"} · ${accountStatusTime(favorites.status)}`;
  document.querySelector('[data-account-role-card="content"]')?.classList.toggle("is-ready", readyState.content);
  document.querySelector('[data-account-role-card="favorites"]')?.classList.toggle("is-ready", readyState.favorites);
  document.querySelector('[data-account-role-card="content"]')?.classList.toggle("is-waiting", ["launching_login", "waiting_for_login"].includes(content.status?.phase));
  document.querySelector('[data-account-role-card="favorites"]')?.classList.toggle("is-waiting", ["launching_login", "waiting_for_login"].includes(favorites.status?.phase));
  const contentLogin = document.querySelector('[data-account-login="content"]');
  const favoritesLogin = document.querySelector('[data-account-login="favorites"]');
  if (contentLogin) {
    contentLogin.disabled = ["launching_login", "waiting_for_login"].includes(content.status?.phase);
    contentLogin.textContent = readyState.content ? "管理/切换账号" : contentLogin.disabled ? "等待登录确认" : "打开登录窗口";
  }
  if (favoritesLogin) {
    favoritesLogin.disabled = ["launching_login", "waiting_for_login"].includes(favorites.status?.phase);
    favoritesLogin.textContent = readyState.favorites ? "管理/切换账号" : favoritesLogin.disabled ? "等待登录确认" : shared ? "登录共用账号" : "打开登录窗口";
  }
  const summary = document.querySelector("#account-sidebar-summary");
  if (summary) summary.innerHTML = `<b class="${content.status?.ready ? "is-ready" : "is-pending"}"></b>采集${content.status?.ready ? "已验证" : "待验证"} · 收藏夹${shared ? "共用" : favorites.status?.ready ? "已验证" : "待验证"}`;
  document.querySelector("#account-capability-note").textContent = "账号隔离与登录路由已启用。收藏夹目录适配器完成真实账号回归前，工作台不会创建收藏夹假任务。";
  if (lastAccountReadyState && !lastAccountReadyState.favorites && readyState.favorites) showToast("收藏夹账号登录成功，状态已同步。", "success");
  lastAccountReadyState = readyState;
}
async function loadAccountProfiles() {
  try {
    const response = await fetch("/api/account-profiles", { cache: "no-store" });
    if (!response.ok) return;
    renderAccountProfiles(await response.json());
  } catch {}
}
document.querySelector("#account-profiles-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const favoritesBinding = document.querySelector('input[name="favorites-binding"]:checked')?.value || "shared";
  try {
    const response = await fetch("/api/account-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ favoritesBinding }),
    });
    const payload = await readApiPayload(response, "保存账号绑定失败");
    lastAccountProfileSignature = "";
    renderAccountProfiles(payload);
    showToast(favoritesBinding === "shared" ? "收藏夹已设置为共用内容采集账号。" : "收藏夹已切换为独立账号，请完成独立登录。", "success");
  } catch (error) {
    showToast(error.message, "review");
  }
});
document.querySelectorAll("[data-account-login]").forEach((button) => button.addEventListener("click", async () => {
  const role = button.dataset.accountLogin;
  button.disabled = true;
  try {
    const response = await fetch(`/api/account-profiles/${encodeURIComponent(role)}/login`, { method: "POST" });
    await readApiPayload(response, "启动登录窗口失败");
    showToast("登录窗口正在打开，请在专用浏览器中完成登录。", "success");
    lastAccountProfileSignature = "";
    window.setTimeout(loadAccountProfiles, 1000);
  } catch (error) {
    showToast(error.message, "review");
  } finally {
    button.disabled = false;
  }
}));
async function loadTranscriptionSettings() {
  const response = await fetch("/api/transcription-settings");
  if (!response.ok) return;
  const settings = await response.json();
  document.querySelector("#cloud-api-base-url").value = settings.cloud?.apiBaseUrl || "";
  document.querySelector("#cloud-client-id").value = settings.cloud?.clientId || "";
  document.querySelector("#cloud-key-status").textContent = settings.cloud?.apiKeyConfigured ? "API Key 已配置，页面不会读取或显示原值。" : "尚未配置有效 API Key。";
  const providerInput = document.querySelector(`input[name="default-provider"][value="${settings.defaultProvider || "getnotes"}"]`);
  if (providerInput) providerInput.checked = true;
  const labels = { ffmpeg: "FFmpeg", model: "Whisper small 模型", python: "项目独立 Python" };
  document.querySelector("#runtime-diagnostics").innerHTML = Object.entries(settings.diagnostics || {}).map(([key, item]) => `<div class="${item.ready ? "is-ready" : "is-missing"}"><strong>${labels[key] || key}</strong><span>${item.ready ? `已就绪 · ${formatRuntimeSize(item.sizeBytes)}` : "缺失"}</span></div>`).join("");
  document.querySelector("#settings-save-state").innerHTML = `<span></span>${Object.values(settings.diagnostics || {}).every((item) => item.ready) ? "本地运行环境就绪" : "本地运行环境不完整"}`;
}
document.querySelector("#transcription-settings-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    defaultProvider: document.querySelector('input[name="default-provider"]:checked')?.value || "getnotes",
    cloud: {
      apiBaseUrl: document.querySelector("#cloud-api-base-url").value.trim(),
      clientId: document.querySelector("#cloud-client-id").value.trim(),
      apiKey: document.querySelector("#cloud-api-key").value.trim(),
    },
  };
  try {
    const response = await fetch("/api/transcription-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "保存失败");
    document.querySelector("#cloud-api-key").value = "";
    showToast("转写设置已保存。", "success");
    loadTranscriptionSettings();
  } catch (error) {
    showToast(`保存转写设置失败：${scrubProviderName(error.message)}`, "review");
  }
});

setActiveView(localStorage.getItem(activeViewKey) || "workbench");
renderStorageLocation();
loadRuntimeConfig();
loadAccountProfiles();
loadTranscriptionSettings();
refreshRuntimeViews();
setInterval(refreshRuntimeViews, 2000);
setInterval(loadAccountProfiles, 5000);
window.addEventListener("focus", loadAccountProfiles);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadAccountProfiles();
});
render();
