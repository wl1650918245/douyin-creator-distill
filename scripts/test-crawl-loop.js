const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-creator-distill-crawl-loop-"));
process.env.KNOWLEDGE_ASSET_ROOT = root;

const {
  classifyCrawlFailure,
  mergeCrawlArtifacts,
  nextLoopStep,
} = require("../src/services/crawl-loop-policy");
const { auditJson } = require("../src/services/json-audit");
const store = require("../src/services/task-store");

function writeArtifact(name, payload) {
  const filepath = path.join(root, `${name}.json`);
  fs.writeFileSync(filepath, JSON.stringify(payload), "utf8");
  return filepath;
}

assert.deepEqual(classifyCrawlFailure("verifycenter/captcha"), {
  code: "verification_required",
  retryable: false,
  requiresUser: true,
});
assert.equal(classifyCrawlFailure("navigation ETIMEDOUT").retryable, true);
assert.equal(classifyCrawlFailure("JSON 审核缺失 3 条").code, "incomplete_directory");
assert.equal(nextLoopStep([]).strategy, "chrome_primary");
assert.equal(nextLoopStep([{}, {}]).strategy, "api_supplement");
assert.equal(nextLoopStep([{}, {}, {}]), null);

const first = writeArtifact("first", {
  douyinId: "demo",
  accountSlug: "demo",
  profileUrl: "https://www.douyin.com/user/target-sec-user",
  pageTotal: 2,
  works: [
    {
      videoId: "1",
      title: "",
      likes: 10,
      contentType: "video",
      publishTimestamp: 100,
      authorSecUserId: "target-sec-user",
      acquisitionSources: ["browser_network"],
    },
  ],
});
const second = writeArtifact("second", {
  douyinId: "demo",
  accountSlug: "demo",
  profileUrl: "https://www.douyin.com/user/target-sec-user",
  pageTotal: 2,
  works: [
    {
      videoId: "1",
      title: "补全后的标题",
      likes: 15,
      contentType: "video",
      publishTimestamp: 100,
      authorSecUserId: "target-sec-user",
      acquisitionSources: ["browser_dom"],
    },
    {
      videoId: "2",
      title: "第二条",
      likes: 5,
      contentType: "image",
      publishTimestamp: 90,
      authorSecUserId: "target-sec-user",
    },
    {
      videoId: "foreign",
      title: "不属于目标博主",
      likes: 999,
      contentType: "video",
      publishTimestamp: 95,
      authorSecUserId: "another-author",
    },
  ],
});
const api = writeArtifact("api", {
  douyinId: "demo",
  accountSlug: "demo",
  profileUrl: "https://www.douyin.com/user/target-sec-user",
  pageTotal: 2,
  works: [
    {
      videoId: "1",
      title: "接口标题不应覆盖已有标题",
      likes: 12,
      contentType: "video",
      publishTimestamp: 100,
      authorSecUserId: "target-sec-user",
    },
  ],
});

const mergedPath = mergeCrawlArtifacts([
  { attempt: 1, strategy: "chrome_primary", outputPath: first, auditStatus: "partial" },
  { attempt: 2, strategy: "chrome_recovery", outputPath: second, auditStatus: "passed" },
  { attempt: 3, strategy: "api_supplement", outputPath: api, auditStatus: "passed" },
], { taskId: "loop-task", source: "demo" });
const merged = JSON.parse(fs.readFileSync(mergedPath, "utf8"));
assert.equal(merged.works.length, 2);
assert.equal(merged.works[0].title, "补全后的标题");
assert.equal(merged.works[0].likes, 15);
assert.deepEqual(merged.works[0].acquisitionSources.sort(), [
  "browser_capture",
  "browser_dom",
  "browser_network",
  "internal_api_supplement",
].sort());
assert.equal(merged.totals.videos, 1);
assert.equal(merged.totals.imagePosts, 1);
assert.equal(merged.acquisition.excludedForeignAuthorWorks.length, 1);
assert.equal(merged.acquisition.excludedForeignAuthorWorks[0].videoId, "foreign");

const baseline = writeArtifact("baseline", {
  douyinId: "demo",
  accountSlug: "demo",
  profileUrl: "https://www.douyin.com/user/target-sec-user",
  pageTotal: 2,
  totals: { allWorks: 1, selectedWorks: 1, videos: 1, imagePosts: 0 },
  works: [{
    videoId: "old",
    title: "old verified work",
    date: "2025-01-01",
    publishTimestamp: 1735689600,
    likes: 1,
    commentCount: 1,
    collectCount: 1,
    shareCount: 1,
    interactionTotal: 4,
    contentType: "video",
    videoUrl: "https://www.douyin.com/video/old",
    shareUrl: "https://www.douyin.com/video/old",
    authorSecUserId: "target-sec-user",
  }],
});
const incremental = writeArtifact("incremental", {
  douyinId: "demo",
  accountSlug: "demo",
  profileUrl: "https://www.douyin.com/user/target-sec-user",
  pageTotal: 2,
  works: [
    {
      videoId: "new",
      title: "new work",
      date: "2025-01-02",
      publishTimestamp: 1735776000,
      likes: 2,
      commentCount: 1,
      collectCount: 1,
      shareCount: 1,
      interactionTotal: 5,
      contentType: "video",
      videoUrl: "https://www.douyin.com/video/new",
      shareUrl: "https://www.douyin.com/video/new",
      authorSecUserId: "target-sec-user",
    },
    {
      videoId: "noise",
      title: "unrelated DOM card",
      date: "",
      publishTimestamp: null,
      contentType: "video",
      acquisitionSources: ["browser_dom"],
    },
  ],
});
const recoveredPath = mergeCrawlArtifacts([
  { attempt: 0, strategy: "verified_baseline", outputPath: baseline, auditStatus: "passed" },
  { attempt: 1, strategy: "chrome_primary", outputPath: incremental, auditStatus: "partial" },
], { taskId: "incremental-loop", source: "demo" });
const recovered = JSON.parse(fs.readFileSync(recoveredPath, "utf8"));
assert.deepEqual(recovered.works.map((work) => work.videoId), ["new", "old"]);
assert.equal(recovered.acquisition.excludedUnverifiedIncompleteWorks.length, 1);
assert.equal(recovered.acquisition.excludedUnverifiedIncompleteWorks[0].videoId, "noise");
assert.equal(auditJson(recoveredPath).status, "passed");

const incompleteApi = writeArtifact("incomplete-api", {
  ...JSON.parse(fs.readFileSync(recoveredPath, "utf8")),
  pageTotal: 3,
});
assert.equal(auditJson(incompleteApi).status, "partial");
assert.equal(auditJson(incompleteApi).summary.countMismatch, true);

store.createTask("loop-task", "demo", {
  sourceMode: "profile",
  accountRole: "content",
  profileId: "content-collector",
  options: { kind: "profile-crawl", loop: { version: 1, maxAttempts: 3 } },
});
store.createTaskAttempt({
  id: "attempt-1",
  taskId: "loop-task",
  attemptNo: 1,
  strategy: "chrome_primary",
  metadata: { label: "首轮" },
});
store.updateTaskAttempt("attempt-1", {
  status: "partial",
  error_class: "incomplete_directory",
  output_path: first,
});
const attempts = store.listTaskAttempts("loop-task");
assert.equal(attempts.length, 1);
assert.equal(attempts[0].metadata.label, "首轮");
assert.equal(attempts[0].error_class, "incomplete_directory");

for (const [id, creator] of [["report-a", "creator-a"], ["report-b", "creator-b"]]) {
  const reportPath = writeArtifact(id, { report: id });
  store.createTask(`task-${id}`, `爆款拆解 / ${creator}`);
  store.createViralReport({
    id,
    taskId: `task-${id}`,
    crawlTaskId: "loop-task",
    creatorName: creator,
    douyinId: creator,
    workIds: [id],
  });
  store.updateViralReport(id, { status: "completed", output_path: reportPath });
}
const { submitTopicBatch } = require("../src/services/content-intelligence-service");
assert.throws(
  () => submitTopicBatch({ reportIds: ["report-a", "report-b"], count: 6 }),
  /不能混合不同博主/,
);

store.closeTaskStore();
fs.rmSync(root, { recursive: true, force: true });
console.log("crawl loop policy and persistence tests passed");
