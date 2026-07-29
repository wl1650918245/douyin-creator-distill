const fs = require("fs");
function auditJson(filePath) {
  const data = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  const works = Array.isArray(data.works) ? data.works : [];
  const blockingFields = ["videoId", "videoUrl", "shareUrl", "publishTimestamp", "date", "likes", "commentCount", "collectCount", "shareCount", "interactionTotal", "contentType"];
  const warningFields = ["title"];
  const fields = [...blockingFields, ...warningFields];
  const isMissing = (value) => value === undefined || value === null || (typeof value === "string" && value.trim() === "");
  const missing = Object.fromEntries(fields.map((field) => [field, works.filter((work) => isMissing(work[field])).length]));
  const warnings = Object.fromEntries(warningFields.map((field) => [field, missing[field]]).filter(([, count]) => count > 0));
  const uniqueIds = new Set(works.map((work) => work.videoId).filter(Boolean)).size;
  const targetSecUserId = String(data.profileUrl || "").match(/douyin\.com\/user\/([^?]+)/)?.[1] || "";
  const foreignAuthorCount = targetSecUserId
    ? works.filter((work) => work.authorSecUserId && work.authorSecUserId !== targetSecUserId).length
    : 0;
  const totals = data.totals || {};
  const blockingMissing = blockingFields.reduce((total, field) => total + missing[field], 0);
  const pageTotal = Number.isFinite(Number(data.pageTotal)) && Number(data.pageTotal) > 0
    ? Number(data.pageTotal)
    : null;
  const countDelta = pageTotal === null ? null : works.length - pageTotal;
  const countMismatch = countDelta !== null && countDelta !== 0;
  const appendOnlyIncremental = data.acquisition?.mode === "append_only_incremental";
  const countMismatchBlocking = countMismatch && !appendOnlyIncremental;
  const passed = works.length > 0
    && totals.selectedWorks === works.length
    && uniqueIds === works.length
    && blockingMissing === 0
    && foreignAuthorCount === 0
    && !countMismatchBlocking;
  const warningCount = Object.values(warnings).reduce((total, count) => total + count, 0);
  return {
    status: passed ? "passed" : "partial",
    data,
    summary: {
      pageTotal,
      totalCount: works.length,
      uniqueIds,
      countDelta,
      countMismatch,
      countMismatchBlocking,
      snapshotMode: appendOnlyIncremental ? "append_only_incremental" : "full_snapshot",
      totals,
      missing,
      warnings,
      warningCount,
      blockingMissing,
      foreignAuthorCount,
    },
  };
}
module.exports = { auditJson };
