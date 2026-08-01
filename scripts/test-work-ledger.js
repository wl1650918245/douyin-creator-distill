const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "creator-distill-ledger-"));
process.env.KNOWLEDGE_ASSET_ROOT = tempRoot;

const store = require("../src/services/task-store");
const ledger = require("../src/services/work-ledger-store");

const outputPath = path.join(tempRoot, "creator.json");
const works = [
  { videoId: "work-1", videoUrl: "https://example.com/work-1", title: "作品一", authorNickname: "测试博主", contentType: "video" },
  { videoId: "work-2", videoUrl: "https://example.com/work-2", title: "作品二", authorNickname: "测试博主", contentType: "video" },
  { videoId: "work-3", videoUrl: "https://example.com/work-3", title: "作品三", authorNickname: "测试博主", contentType: "video" },
];
fs.writeFileSync(outputPath, JSON.stringify({ works }), "utf8");

store.createTask("crawl-1", "creator-test", { sourceMode: "profile", accountRole: "content", profileId: "content-test" });
store.updateTask("crawl-1", { status: "waiting_for_user", audit_status: "passed", output_path: outputPath });

const first = ledger.ingestCrawlArtifact({ taskId: "crawl-1", runId: "run-1", outputPath, auditStatus: "passed" });
const second = ledger.ingestCrawlArtifact({ taskId: "crawl-1", runId: "run-2", outputPath, auditStatus: "passed" });
assert.equal(first.imported, 3);
assert.equal(second.imported, 0, "重复导入不得增加作品总账");
assert.equal(ledger.listWorkLedgerSummaries()[0].total, 3);

store.createTask("batch-1", "Whisper转写 / creator-test", { sourceMode: "profile", accountRole: "content", profileId: "content-test" });
store.updateTask("batch-1", { summary_json: JSON.stringify({ provider: "whisper" }) });
store.createTranscriptJob({ id: "job-1", taskId: "batch-1", crawlTaskId: "crawl-1", videoId: "work-1", videoUrl: works[0].videoUrl, title: works[0].title, provider: "whisper" });
store.createTranscriptJob({ id: "job-2", taskId: "batch-1", crawlTaskId: "crawl-1", videoId: "work-2", videoUrl: works[1].videoUrl, title: works[1].title, provider: "whisper" });
store.createTranscriptJob({ id: "job-active", taskId: "batch-1", crawlTaskId: "crawl-1", videoId: "work-3", videoUrl: works[2].videoUrl, title: works[2].title, provider: "whisper" });
const transcriptPath = path.join(tempRoot, "work-1.md");
fs.writeFileSync(transcriptPath, "已完成文本", "utf8");
store.updateTranscriptJob("job-1", { status: "completed", output_path: transcriptPath, attempt_count: 1 });
store.updateTranscriptJob("job-2", { status: "failed", error_message: "模拟失败", attempt_count: 3 });

let summary = ledger.listWorkLedgerSummaries()[0];
assert.equal(summary.transcriptionCompleted, 1);
assert.equal(summary.transcriptionFailed, 1);
assert.equal(summary.transcriptionActive, 1);

store.createTask("batch-2", "Whisper转写 / creator-test", { sourceMode: "profile", accountRole: "content", profileId: "content-test" });
store.updateTask("batch-2", { summary_json: JSON.stringify({ provider: "whisper" }) });
store.createTranscriptJob({ id: "job-3", taskId: "batch-2", crawlTaskId: "crawl-1", videoId: "work-1", videoUrl: works[0].videoUrl, title: works[0].title, provider: "whisper" });
store.updateTranscriptJob("job-3", { status: "failed", error_message: "后续任务失败", attempt_count: 1 });
summary = ledger.listWorkLedgerSummaries()[0];
assert.equal(summary.transcriptionCompleted, 1, "历史成功不得被后续失败降级");

const plan = ledger.filterProcessableWorks("crawl-1", works);
assert.deepEqual(plan.skippedCompleted, ["work-1"]);
assert.deepEqual(plan.works.map((work) => work.videoId), ["work-2"], "历史失败作品应进入下一批次");
assert.deepEqual(plan.skippedActive, ["work-3"], "正在处理的作品不得重复创建任务");

ledger.saveTaskCheckpoint("batch-1", "transcription-batch", "partial", "work-2", { completed: 1, failed: 1 });
const checkpoint = ledger.getTaskCheckpoint("batch-1", "transcription-batch");
assert.equal(checkpoint.cursor, "work-2");
assert.deepEqual(checkpoint.payload, { completed: 1, failed: 1 });

store.closeTaskStore();
ledger.closeWorkLedger();
fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("work ledger idempotency, state aggregation, retry planning and checkpoint tests passed");
