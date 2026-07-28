function buildWorkAssetStem(work) {
  const published = String(work.date || "").replace(/\D/g, "").slice(0, 8);
  const shortDate = published.length === 8 ? published.slice(2) : "日期未知";
  const title = String(work.title || work.desc || "未命名作品")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[ .]+$/g, "")
    .slice(0, 24) || "未命名作品";
  return `douyin_${shortDate}_${title}_${work.videoId}`;
}

module.exports = { buildWorkAssetStem };
