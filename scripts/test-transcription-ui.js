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
    assert.deepEqual(pageErrors, []);
    console.log("transcription priority ui ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
