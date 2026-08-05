const assert = require("assert/strict");
const { chromium } = require("playwright");
const { findChromePath } = require("../src/config/runtime-config");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";

(async () => {
  const browser = await chromium.launch({ executablePath: findChromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    const selectionBarMetrics = await page.locator("#selection-bar").evaluate((bar) => {
      bar.classList.add("is-transcribing");
      bar.querySelector("#selection-count").textContent = "已选 639 条作品";
      bar.querySelector("#selection-note").textContent = "云端优先全量批处理中，这是一段用于验证大量作品转写状态的长说明，底部工具栏不能被说明文字或批量按钮撑高。";
      const labels = ["爆款初筛 639 条", "转写所选 639 条", "深度拆解 639 条", "加入蒸馏素材池 639 条"];
      [...bar.querySelectorAll(".selection-actions button")].forEach((button, index) => {
        button.textContent = labels[index];
      });
      return {
        height: bar.getBoundingClientRect().height,
        buttonHeights: [...bar.querySelectorAll(".selection-actions button")]
          .map((button) => button.getBoundingClientRect().height),
      };
    });
    assert.ok(selectionBarMetrics.height <= 100, `批量转写浮层过高: ${selectionBarMetrics.height}px`);
    assert.ok(selectionBarMetrics.buttonHeights.every((height) => height <= 42));
    await page.locator("button[data-open-settings]").click();
    await page.locator("#settings-view").waitFor({ state: "visible" });
    assert.equal(await page.locator('input[name="default-provider"][value="cloud-first"]').count(), 1);
    assert.equal(await page.locator('input[name="default-provider"][value="whisper-first"]').count(), 1);
    assert.equal(await page.locator('input[name="default-provider"][value="cloud-first"]').isChecked(), true);
    assert.deepEqual(await page.locator("#transcription-provider-dialog .provider-option").evaluateAll((buttons) => buttons.map((button) => button.value)), ["cloud-first", "whisper-first"]);
    assert.match(await page.locator("#transcription-provider-dialog").innerText(), /批次总数不受 100 条限制/);
    const retryMarkup = await page.evaluate(() => transcriptionTaskActions({
      id: "partial-batch",
      status: "partial",
      summary: { provider: "cloud-first", totalCount: 639, completed: 317, failed: 322 },
    }));
    assert.match(retryMarkup, /继续剩余 322 条/);
    assert.match(retryMarkup, /打开全部转写位置/);
    await page.evaluate(() => renderSourceProgress({
      id: "partial-batch",
      source: "云端优先转写 / jianghushuo",
      status: "partial",
      error_message: "322 条作品失败；其余作品已保留",
      summary: { provider: "cloud-first", totalCount: 639, completed: 317, failed: 322 },
    }));
    assert.match(await page.locator("#source-progress").innerText(), /总计 639 条.*已完成 317.*剩余 322/s);
    assert.equal(await page.locator('#source-progress [data-transcription-retry="partial-batch"]').innerText(), "继续剩余 322 条");
    await page.evaluate(() => renderSourceProgress({
      id: "running-batch",
      source: "云端优先转写 / jianghushuo",
      creator_name: "姜胡说",
      status: "running",
      progress: { currentVideoId: "7663157184638105158", currentTitle: "蒸馏你的 CEO 太爽了", currentProvider: "whisper" },
      summary: { provider: "cloud-first", totalCount: 639, completed: 357, queued: 281, running: 1 },
    }));
    const runningText = await page.locator("#source-progress").innerText();
    assert.match(runningText, /蒸馏你的 CEO 太爽了/);
    assert.match(runningText, /7663157184638105158/);
    assert.match(runningText, /本地 Whisper/);
    const pendingTaskId = await page.evaluate(() => {
      activeSourceTaskId = "";
      return sourceProgressTask([
        { id: "latest-directory", source: "feitianshanke", status: "waiting_for_user", summary: { totalCount: 81 } },
        { id: "unfinished-transcription", source: "云端优先转写 / jianghushuo", status: "partial", summary: { provider: "cloud-first", totalCount: 639, completed: 317, failed: 322 } },
      ]).id;
    });
    assert.equal(pendingTaskId, "unfinished-transcription");
    const archiveSummary = await page.evaluate(() => creatorArchiveEntries([
      { id: "crawl-1", source: "jianghushuo", status: "waiting_for_user", output_path: "C:\\assets\\jianghushuo.json", updated_at: "2026-08-01T12:00:00Z", summary: { totalCount: 639 } },
      { id: "batch-1", source: "云端优先转写 / jianghushuo", status: "partial", updated_at: "2026-08-01T13:00:00Z", summary: { provider: "cloud-first", total: 639, completed: 317, failed: 322 } },
    ], [
      { task_id: "crawl-1", created_at: "2026-08-01T12:00:00Z" },
    ], [
      { task_id: "batch-1", crawl_task_id: "crawl-1", video_id: "video-1", status: "completed", updated_at: "2026-08-01T13:00:00Z" },
      { task_id: "batch-1", crawl_task_id: "crawl-1", video_id: "video-1", status: "completed", updated_at: "2026-08-01T12:30:00Z" },
      { task_id: "batch-1", crawl_task_id: "crawl-1", video_id: "video-2", status: "completed", updated_at: "2026-08-01T12:40:00Z" },
      { task_id: "batch-1", crawl_task_id: "crawl-1", video_id: "video-3", status: "failed", updated_at: "2026-08-01T12:50:00Z" },
    ], [
      { id: "subscription-1", source_key: "creator:jianghushuo", source_type: "creator", source: "jianghushuo", updated_at: "2026-08-01T12:00:00Z" },
    ])[0]);
    assert.equal(archiveSummary.completedTranscripts, 2, "关注页应按作品 ID 去重统计已完成转写");
    assert.equal(archiveSummary.pendingTranscription.id, "batch-1", "关注页应定位该博主最近的未完成批次");
    assert.equal(archiveSummary.runCount, 1, "目录版本数量应来自抓取记录");
    const ledgerArchiveSummary = await page.evaluate(() => creatorArchiveEntries([
      { id: "crawl-ledger", source: "jianghushuo", status: "waiting_for_user", output_path: "C:\\assets\\jianghushuo.json", updated_at: "2026-08-01T12:00:00Z", summary: { totalCount: 639 } },
    ], [], [], [
      { id: "subscription-ledger", source_key: "creator:jianghushuo", source_type: "creator", source: "jianghushuo", updated_at: "2026-08-01T12:00:00Z" },
    ], [
      { sourceKey: "creator:jianghushuo", total: 641, transcriptionCompleted: 336 },
    ])[0]);
    assert.equal(ledgerArchiveSummary.completedTranscripts, 336, "关注页应优先读取作品总账的全局转写数量");
    assert.equal(ledgerArchiveSummary.ledgerSummary.total, 641, "关注页应保留作品总账的唯一作品数量");
    await page.evaluate(() => renderCreatorArchive([{
      source: "creator:jianghushuo",
      subscription: { id: "subscription-ui", source_key: "creator:jianghushuo", source_type: "creator", source: "jianghushuo", display_name: "姜胡说", enabled: true, check_interval_minutes: 1440, updated_at: "2026-08-01T12:00:00Z" },
      latest: { id: "crawl-ui", source: "jianghushuo", status: "waiting_for_user", output_path: "C:\\assets\\jianghushuo.json", updated_at: "2026-08-01T12:00:00Z", summary: { totalCount: 641 } },
      runCount: 2,
      completedTranscripts: 336,
      relatedRuns: [{ task_id: "crawl-ui", total_count: 641, audit_status: "passed", created_at: "2026-08-01T12:00:00Z" }],
      transcripts: [],
      pendingTranscription: null,
    }], true));
    const statCards = page.locator("#creator-archive-detail .creator-stat-card");
    assert.equal(await statCards.count(), 3);
    assert.equal(await statCards.nth(0).getAttribute("data-creator-open"), "crawl-ui");
    assert.equal(await statCards.nth(1).getAttribute("data-creator-scroll-runs"), "true");
    assert.equal(await statCards.nth(2).getAttribute("data-creator-transcript-source"), "creator:jianghushuo");
    assert.deepEqual(pageErrors, []);
    console.log("transcription priority ui ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
