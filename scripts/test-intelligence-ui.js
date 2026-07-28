const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { findChromePath } = require("../src/config/runtime-config");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";
const screenshotDir = path.resolve(__dirname, "../runtime");

(async () => {
  fs.mkdirSync(screenshotDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: findChromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator('.nav-item[data-view="topics"]').click();
    await page.locator("#topics-view").waitFor({ state: "visible" });
    await page.waitForFunction(() => Number(document.querySelector("#topic-report-count")?.textContent || 0) > 0);
    assert.equal(await page.locator("#topic-report-count").innerText(), "2");
    assert.equal(await page.locator(".topic-source-item").count(), 2);
    assert.equal(await page.locator("#generate-topics").isEnabled(), true);
    await page.screenshot({ path: path.join(screenshotDir, "topic-advisor-demo.png"), fullPage: true });

    await page.locator('.nav-item[data-view="agent"]').click();
    await page.locator("#agent-view").waitFor({ state: "visible" });
    await page.waitForFunction(() => Number(document.querySelector("#agent-creator-count")?.textContent || 0) > 0);
    assert.equal(await page.locator("#agent-creator-count").innerText(), "3");
    assert.equal(await page.locator(".agent-creator-item").count(), 3);
    assert.match(await page.locator("#agent-readiness-card").innerText(), /飞天闪客/);
    assert.equal(await page.locator("#generate-creator-agent").isEnabled(), true);
    await page.screenshot({ path: path.join(screenshotDir, "creator-agent-demo.png"), fullPage: true });

    assert.deepEqual(pageErrors, []);
    console.log("content intelligence ui ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
