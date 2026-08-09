const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "creator-analytics-"));
process.env.KNOWLEDGE_ASSET_ROOT = temporaryDirectory;

const { normalizeWork, parseDashboardText, parseHumanNumber } = require("../src/adapters/douyin/creator-analytics-crawler");
const store = require("../src/services/creator-analytics-store");

function payload(snapshotAt, followers, viewCount) {
  return {
    snapshotAt,
    permissionStatus: "available",
    account: { accountId: "account-1", douyinId: "test-account", nickname: "测试账号" },
    metrics: { following: 20, followers, totalLikes: 300, periodPlayCount: 1200, recentWorkCount: 1 },
    works: [{
      videoId: "work-1",
      title: "测试作品",
      publishTimestamp: "2026-08-01T00:00:00.000Z",
      metrics: { viewCount, completionRate: 0.42, subscribeRate: 0.03 },
    }],
  };
}

try {
  assert.equal(parseHumanNumber("+1.08万"), 10800);
  assert.equal(parseHumanNumber("-29"), -29);
  assert.equal(parseHumanNumber("2.7亿"), 270000000);

  const dashboardText = `测试账号
抖音号：test-account
关注
20
粉丝
3,658
获赞
2.77万
新的创作
数据总览
统计周期：08-01 至 08-07
播放量
2.74万
较前7日+1.08万
主页访问量
328
较前7日-29
作品分享
30
较前7日-1
作品评论
49
较前7日+11
互动管理`;
  const parsed = parseDashboardText(dashboardText);
  assert.equal(parsed.account.nickname, "测试账号");
  assert.equal(parsed.account.followers, 3658);
  assert.equal(parsed.metrics.periodPlayCount, 27400);
  assert.equal(parsed.metrics.periodPlayChange, 10800);
  assert.equal(parsed.metrics.periodHomepageVisitChange, -29);
  assert.equal(parsed.permissionStatus, "available");

  const work = normalizeWork({ id: "work-1", description: "一条作品", create_time: 1785542400, type: 0, metrics: { view_count: 500, completion_rate: 0.36, subscribe_rate: 0.02 } });
  assert.equal(work.videoId, "work-1");
  assert.equal(work.contentType, "video");
  assert.equal(work.metrics.completionRate, 0.36);

  const first = store.createRun({ accountRole: "favorites", profileId: "favorites-owner", triggerMode: "manual" });
  store.saveSuccess(first.id, payload("2026-08-09T12:00:00.000Z", 100, 1000), { outputPath: "one.json", reportPath: "one.md" });
  const second = store.createRun({ accountRole: "favorites", profileId: "favorites-owner", triggerMode: "schedule" });
  store.saveSuccess(second.id, payload("2026-08-10T12:00:00.000Z", 108, 1300), { outputPath: "two.json", reportPath: "two.md" });

  const dashboard = store.dashboard();
  assert.equal(dashboard.latest.nickname, "测试账号");
  assert.equal(dashboard.delta.followers, 8);
  assert.equal(dashboard.works.length, 1);
  assert.equal(dashboard.works[0].metrics.viewCount, 1300);
  const third = store.createRun({ accountRole: "content", profileId: "content-owner", triggerMode: "manual" });
  const otherAccount = payload("2026-08-10T13:00:00.000Z", 999, 9000);
  otherAccount.account = { accountId: "account-2", douyinId: "other-account", nickname: "另一个账号" };
  store.saveSuccess(third.id, otherAccount, { outputPath: "three.json", reportPath: "three.md" });
  assert.equal(store.dashboard("favorites-owner").latest.nickname, "测试账号");
  assert.equal(store.dashboard("favorites-owner").delta.followers, 8);
  assert.equal(store.dashboard("content-owner").latest.nickname, "另一个账号");
  store.updateSettings({ enabled: true, checkIntervalMinutes: 1440 });
  assert.equal(store.getSettings().enabled, true);
  console.log("[通过] 创作者经营解析、快照、趋势与调度设置契约正确");
} finally {
  store.close();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
