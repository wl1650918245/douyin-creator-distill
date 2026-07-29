const fs = require("fs");
const path = require("path");

const LOOP_STEPS = [
  { strategy: "chrome_primary", label: "Chrome 第一次抓取", directApi: false },
  { strategy: "chrome_recovery", label: "Chrome 修复性抓取", directApi: false },
  { strategy: "api_supplement", label: "API 定向补漏", directApi: true },
];

const USER_ACTION_PATTERNS = [
  { code: "verification_required", pattern: /verifycenter\/captcha|captcha_container|安全验证|验证码/i },
  { code: "authentication_required", pattern: /not logged in|登录失效|需要登录|请.*登录|login required/i },
  { code: "rate_limited", pattern: /(?:^|\D)(?:403|429)(?:\D|$)|too many requests|rate.?limit|请求频繁|访问受限/i },
];

const TRANSIENT_PATTERNS = [
  /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|socket hang up|network.*(?:timeout|failed)|页面加载失败|导航失败|页面.*关闭/i,
  /profile.*lock|Chrome.*(?:占用|in use)|browser.*closed/i,
];

function classifyCrawlFailure(input = "") {
  const text = String(input || "");
  for (const rule of USER_ACTION_PATTERNS) {
    if (rule.pattern.test(text)) return { code: rule.code, retryable: false, requiresUser: true };
  }
  if (/抖音号.*(?:不存在|无效)|账号.*不存在|invalid.*(?:source|account)/i.test(text)) {
    return { code: "invalid_source", retryable: false, requiresUser: true };
  }
  if (TRANSIENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { code: "transient_runtime", retryable: true, requiresUser: false };
  }
  if (/审核|缺失|数量|重复|游标|分页|未生成可用目录|无法找到博主卡片/i.test(text)) {
    return { code: "incomplete_directory", retryable: true, requiresUser: false };
  }
  return { code: "unknown_recoverable", retryable: true, requiresUser: false };
}

function nextLoopStep(attempts = []) {
  return LOOP_STEPS[attempts.length] || null;
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function mergeWorkRecords(current, incoming) {
  if (!current) return { ...incoming, acquisitionSources: [...new Set(incoming.acquisitionSources || [])] };
  const merged = { ...current };
  const numericMaxFields = ["likes", "commentCount", "collectCount", "shareCount", "playCount", "interactionTotal", "durationMs"];
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "acquisitionSources") continue;
    if (numericMaxFields.includes(key)) {
      merged[key] = Math.max(Number(current[key] || 0), Number(value || 0));
    } else if (Array.isArray(value)) {
      merged[key] = [...new Set([...(Array.isArray(current[key]) ? current[key] : []), ...value])];
    } else if (isMissing(current[key]) && !isMissing(value)) {
      merged[key] = value;
    }
  }
  merged.acquisitionSources = [...new Set([
    ...(current.acquisitionSources || []),
    ...(incoming.acquisitionSources || []),
  ])];
  return merged;
}

function readPayload(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}

function profileOwnerSecUserId(payload) {
  return String(payload?.profileUrl || "").match(/douyin\.com\/user\/([^?]+)/)?.[1] || "";
}

function acquisitionSourceForStrategy(strategy) {
  if (strategy === "api_supplement") return "internal_api_supplement";
  if (strategy === "verified_baseline") return "verified_baseline";
  return "browser_capture";
}

function mergeCrawlArtifacts(artifacts, { taskId, source }) {
  if (!artifacts.length) throw new Error("没有可合并的抓取产物");
  const payloads = artifacts.map((artifact) => ({ artifact, payload: readPayload(artifact.outputPath) }));
  const works = new Map();
  let pageTotal = null;
  for (const { artifact, payload } of payloads) {
    if (Number.isFinite(Number(payload.pageTotal))) pageTotal = Math.max(pageTotal || 0, Number(payload.pageTotal));
    for (const work of Array.isArray(payload.works) ? payload.works : []) {
      const videoId = String(work.videoId || "").trim();
      if (!videoId) continue;
      const incoming = {
        ...work,
        acquisitionSources: [...new Set([
          ...(work.acquisitionSources || []),
          acquisitionSourceForStrategy(artifact.strategy),
        ])],
      };
      works.set(videoId, mergeWorkRecords(works.get(videoId), incoming));
    }
  }

  const latest = payloads[payloads.length - 1].payload;
  const targetSecUserId = payloads.map(({ payload }) => profileOwnerSecUserId(payload)).find(Boolean) || "";
  const allMergedWorks = [...works.values()];
  const excludedWorks = targetSecUserId
    ? allMergedWorks.filter((work) => work.authorSecUserId && work.authorSecUserId !== targetSecUserId)
    : [];
  const unverifiedIncompleteWorks = allMergedWorks.filter((work) => {
    const sources = new Set(work.acquisitionSources || []);
    const hasTrustedEvidence = sources.has("verified_baseline") || sources.has("internal_api_supplement");
    return !work.authorSecUserId
      && (isMissing(work.publishTimestamp) || isMissing(work.date))
      && !hasTrustedEvidence;
  });
  const excludedIds = new Set([
    ...excludedWorks.map((work) => String(work.videoId)),
    ...unverifiedIncompleteWorks.map((work) => String(work.videoId)),
  ]);
  const mergedWorks = allMergedWorks
    .filter((work) => !excludedIds.has(String(work.videoId)))
    .sort((left, right) => Number(right.publishTimestamp || 0) - Number(left.publishTimestamp || 0));
  const totals = {
    allWorks: mergedWorks.length,
    selectedWorks: mergedWorks.length,
    videos: mergedWorks.filter((work) => work.contentType !== "image").length,
    imagePosts: mergedWorks.filter((work) => work.contentType === "image").length,
  };
  const result = {
    ...latest,
    exportedAt: new Date().toISOString(),
    douyinId: latest.douyinId || source,
    pageTotal,
    totals,
    works: mergedWorks,
    acquisition: {
      policy: "chrome-primary-chrome-recovery-api-supplement",
      taskId,
      attempts: artifacts.map((artifact) => ({
        attempt: artifact.attempt,
        strategy: artifact.strategy,
        outputPath: artifact.outputPath,
        auditStatus: artifact.auditStatus || null,
      })),
      targetSecUserId: targetSecUserId || null,
      excludedForeignAuthorWorks: excludedWorks.map((work) => ({
        videoId: work.videoId,
        authorNickname: work.authorNickname || "",
        authorSecUserId: work.authorSecUserId,
      })),
      excludedUnverifiedIncompleteWorks: unverifiedIncompleteWorks.map((work) => ({
        videoId: work.videoId,
        title: work.title || "",
        acquisitionSources: work.acquisitionSources || [],
      })),
    },
  };
  const outputDir = path.dirname(artifacts[0].outputPath);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = String(latest.accountSlug || source || "douyin").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  const outputPath = path.join(outputDir, `${slug}-${stamp}-loop-merged.json`);
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), "utf8");
  return outputPath;
}

module.exports = {
  LOOP_STEPS,
  classifyCrawlFailure,
  mergeCrawlArtifacts,
  mergeWorkRecords,
  nextLoopStep,
};
