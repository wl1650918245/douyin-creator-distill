const assert = require("assert");
const { chromium } = require("playwright");
const { findChromePath } = require("../src/config/runtime-config");

const baseUrl = process.env.TEST_BASE_URL || "http://127.0.0.1:8780";

(async () => {
  const browser = await chromium.launch({ executablePath: findChromePath(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.locator("button[data-open-settings]").click();
    await page.locator("#semantic-model-list .semantic-model-card").first().waitFor();
    assert.equal(await page.locator("#semantic-model-list .semantic-model-card").count(), 2);
    assert.match(await page.locator("#semantic-model-list").innerText(), /轻量模式/);
    assert.match(await page.locator("#semantic-model-list").innerText(), /高精度模式/);
    assert.match(await page.locator(".semantic-rerank-card").innerText(), /复用|精排复核/);
    assert.equal(await page.locator('[data-semantic-action="detect"]').count(), 2);
    assert.equal(await page.locator('[data-semantic-action="download"]').count(), 2);
    assert.equal(await page.locator('[data-semantic-action="delete"]').count(), 2);
    assert.equal(pageErrors.length, 0);
    console.log("semantic model settings ui ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
