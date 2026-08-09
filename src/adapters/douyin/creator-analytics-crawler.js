const { chromium } = require("playwright");
const { resolveAccountRole } = require("../../config/account-profiles");
const {
  acquireProfileLockWithRetry,
  buildChromeLaunchArgs,
  findChromePath,
  resolveChromeProfile,
} = require("../../config/runtime-config");

const HOME_URL = "https://creator.douyin.com/creator-micro/home";

function parseHumanNumber(value) {
  const text = String(value || "").replace(/,/g, "").trim();
  const match = text.match(/^([+-]?\d+(?:\.\d+)?)\s*(万|亿)?/);
  if (!match) return null;
  const scale = match[2] === "亿" ? 100000000 : match[2] === "万" ? 10000 : 1;
  return Math.round(Number(match[1]) * scale);
}

function nextValue(lines, label, start = 0) {
  for (let index = start; index < lines.length; index += 1) {
    if (lines[index] !== label) continue;
    let cursor = index + 1;
    while (lines[cursor] === label) cursor += 1;
    return { value: parseHumanNumber(lines[cursor]), raw: lines[cursor] || "", index: cursor };
  }
  return { value: null, raw: "", index: -1 };
}

function parseDashboardText(bodyText) {
  const lines = String(bodyText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const idIndex = lines.findIndex((line) => /^抖音号[：:]/.test(line));
  const douyinId = idIndex >= 0 ? lines[idIndex].replace(/^抖音号[：:]\s*/, "").trim() : "";
  const nickname = idIndex > 0 ? lines[idIndex - 1] : "";
  const accountEnd = lines.indexOf("新的创作");
  const accountLines = lines.slice(0, accountEnd > 0 ? accountEnd : Math.min(lines.length, 30));
  const overviewStart = lines.indexOf("数据总览");
  const overviewEnd = lines.indexOf("互动管理", overviewStart + 1);
  const overview = overviewStart >= 0 ? lines.slice(overviewStart, overviewEnd > overviewStart ? overviewEnd : overviewStart + 40) : [];
  const periodText = lines.find((line) => line.startsWith("统计周期："))?.replace("统计周期：", "") || "";
  const following = nextValue(accountLines, "关注").value;
  const followers = nextValue(accountLines, "粉丝").value;
  const totalLikes = nextValue(accountLines, "获赞").value;
  const periodPlay = nextValue(overview, "播放量");
  const homepageVisits = nextValue(overview, "主页访问量");
  const shares = nextValue(overview, "作品分享");
  const comments = nextValue(overview, "作品评论");
  const changeAfter = (entry) => entry.index >= 0 ? parseHumanNumber(overview[entry.index + 1]?.replace(/^较前7日/, "")) : null;
  return {
    account: { douyinId, nickname, following, followers, totalLikes },
    metrics: {
      following,
      followers,
      totalLikes,
      period: periodText,
      periodPlayCount: periodPlay.value,
      periodPlayChange: changeAfter(periodPlay),
      periodHomepageVisits: homepageVisits.value,
      periodHomepageVisitChange: changeAfter(homepageVisits),
      periodShares: shares.value,
      periodShareChange: changeAfter(shares),
      periodComments: comments.value,
      periodCommentChange: changeAfter(comments),
    },
    permissionStatus: lines.includes("暂未开通数据中心权限") ? "restricted" : overviewStart >= 0 ? "available" : "unknown",
  };
}

function numberMetric(metrics, key) {
  const value = metrics?.[key];
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWork(item) {
  const metrics = item?.metrics || {};
  return {
    videoId: String(item?.id || ""),
    title: String(item?.description || "").trim() || `作品 ${item?.id || ""}`,
    publishTimestamp: item?.create_time ? new Date(Number(item.create_time) * 1000).toISOString() : null,
    contentType: Number(item?.type) === 1 ? "image" : "video",
    metrics: {
      viewCount: numberMetric(metrics, "view_count"),
      avgViewSeconds: numberMetric(metrics, "avg_view_second"),
      avgViewProportion: numberMetric(metrics, "avg_view_proportion"),
      bounceRate2s: numberMetric(metrics, "bounce_rate_2s"),
      completionRate: numberMetric(metrics, "completion_rate"),
      completionRate5s: numberMetric(metrics, "completion_rate_5s"),
      likeCount: numberMetric(metrics, "like_count"),
      likeRate: numberMetric(metrics, "like_rate"),
      commentCount: numberMetric(metrics, "comment_count"),
      commentRate: numberMetric(metrics, "comment_rate"),
      favoriteCount: numberMetric(metrics, "favorite_count"),
      favoriteRate: numberMetric(metrics, "favorite_rate"),
      shareCount: numberMetric(metrics, "share_count"),
      shareRate: numberMetric(metrics, "share_rate"),
      homepageVisitCount: numberMetric(metrics, "homepage_visit_count"),
      subscribeCount: numberMetric(metrics, "subscribe_count"),
      subscribeRate: numberMetric(metrics, "subscribe_rate"),
      unsubscribeCount: numberMetric(metrics, "unsubscribe_count"),
      unsubscribeRate: numberMetric(metrics, "unsubscribe_rate"),
      fanViewProportion: numberMetric(metrics, "fan_view_proportion"),
      downloadCount: numberMetric(metrics, "download_count"),
      dislikeCount: numberMetric(metrics, "dislike_count"),
    },
  };
}

async function collectCreatorAnalytics(accountRole, onProgress = () => {}) {
  const account = resolveAccountRole(accountRole);
  const profile = resolveChromeProfile(account.profilePath);
  const lock = await acquireProfileLockWithRetry(profile.profilePath, { timeoutMs: 120000, retryIntervalMs: 1500 });
  let context = null;
  try {
    onProgress("正在打开官方创作者中心");
    context = await chromium.launchPersistentContext(profile.userDataDir, {
      executablePath: findChromePath(),
      headless: false,
      args: buildChromeLaunchArgs(profile.profileDirectory),
    });
    const page = context.pages()[0] || await context.newPage();
    let itemPayload = null;
    page.on("response", async (response) => {
      if (!response.url().includes("/web/api/creator/item/list") || response.status() !== 200) return;
      try { itemPayload = await response.json(); } catch { /* 页面正文仍可形成受限快照。 */ }
    });
    await page.goto(HOME_URL, { waitUntil: "domcontentloaded", timeout: 120000 });
    onProgress("正在验证经营账号与数据权限");
    await page.getByText(/抖音号[：:]/).first().waitFor({ state: "visible", timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(8000);
    const pageUrl = page.url();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (!pageUrl.includes("creator.douyin.com/creator-micro/home") || !/抖音号[：:]/.test(bodyText)) {
      throw new Error("经营账号登录态无效；请在账号中心重新登录后再分析");
    }
    const parsed = parseDashboardText(bodyText);
    if (!parsed.account.douyinId) throw new Error("未能识别创作者账号；页面可能正在验证或结构已经变化");
    const rawItems = Array.isArray(itemPayload?.items) ? itemPayload.items : [];
    const works = rawItems.map(normalizeWork).filter((work) => work.videoId);
    const accountId = String(rawItems.find((item) => item?.user_id)?.user_id || parsed.account.douyinId);
    onProgress(`已读取 ${parsed.account.nickname} 的账号概览与 ${works.length} 条近期作品指标`);
    return {
      schemaVersion: "1.0",
      snapshotAt: new Date().toISOString(),
      source: "douyin_creator_center",
      accountRole,
      profileId: account.profileId,
      account: { ...parsed.account, accountId },
      permissionStatus: parsed.permissionStatus,
      metrics: { ...parsed.metrics, recentWorkCount: works.length },
      works,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    lock.release();
  }
}

module.exports = { collectCreatorAnalytics, normalizeWork, parseDashboardText, parseHumanNumber };
