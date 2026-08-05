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
    await page.waitForFunction(() => /已索引\s+\d+/.test(document.querySelector("#semantic-index-status")?.textContent || ""));
    await page.locator("#semantic-query").fill("普通人如何赚钱");
    await page.locator("#semantic-search-button").click();
    await page.waitForFunction(() => /找到\s+\d+\s+条相关作品/.test(document.querySelector("#semantic-index-status")?.textContent || ""));
    const visibleRows = await page.locator("#works-body tr.is-semantic-match").count();
    assert.ok(visibleRows > 0, "智能搜索应在作品目录中显示语义匹配结果");
    assert.match(await page.locator("#works-body").innerText(), /普通人|赚钱|财富|收入/);
    assert.equal(await page.locator(".semantic-score").count() > 0, true);
    assert.deepEqual(pageErrors, []);
    console.log(`[通过] 页面智能搜索真实联动 ${visibleRows} 条当前页结果`);
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
