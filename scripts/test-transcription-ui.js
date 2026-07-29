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
