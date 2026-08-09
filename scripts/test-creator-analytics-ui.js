const assert = require("assert");
const { chromium } = require("playwright");
const { findChromePath } = require("../src/config/runtime-config");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";

(async () => {
  const browser = await chromium.launch({ executablePath: findChromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="operations"]').click();
    await page.locator("#operations-view").waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#operations-account-name")?.textContent !== "等待识别");
    assert.equal(await page.locator("#view-title").innerText(), "账号经营");
    assert.notEqual(await page.locator("#operations-account-name").innerText(), "等待首次分析");
    assert.match(await page.locator("#operations-followers").innerText(), /\d/);
    assert.equal(await page.locator("#operations-schedule-enabled").isChecked(), true);
    assert.equal(await page.locator("#operations-works-body tr").count() > 0, true);
    assert.match(await page.locator("#operations-history-list").innerText(), /分析完成/);

    await page.locator(".settings-button[data-open-settings]").click();
    await page.locator("#account-profiles-form").waitFor({ state: "visible" });
    const settings = await page.evaluate(() => fetch("/api/account-profiles", { cache: "no-store" }).then((response) => response.json()));
    assert.equal(await page.locator(`input[name="analytics-account-role"][value="${settings.analyticsAccountRole}"]`).isChecked(), true);
    assert.equal(pageErrors.length, 0, pageErrors.join("\n"));
    console.log("[通过] 账号经营页面、真实快照、每日开关与账号绑定渲染正确");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
