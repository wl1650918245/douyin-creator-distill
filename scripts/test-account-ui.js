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
    await page.waitForFunction(() => !document.querySelector("#account-sidebar-summary")?.textContent.includes("正在读取"));
    assert.equal(await page.title(), "CreatorDistill · 自媒体工作台");
    assert.equal((await page.locator(".brand").innerText()).includes("CreatorDistill"), true);
    assert.equal((await page.locator(".brand").innerText()).includes("自媒体工作台"), true);
    assert.equal((await page.locator("body").innerText()).includes("抖音工作台"), false);
    assert.match(await page.locator(".source-examples").innerText(), /我的收藏夹/);
    assert.equal(await page.locator("#fetch-favorites").isVisible(), true);
    assert.equal(await page.locator("#fetch-favorites").innerText(), "抓取我的收藏夹");
    assert.match(await page.locator(".source-favorites-action").innerText(), /使用已验证的收藏夹账号/);
    await page.locator("#manage-accounts").click();
    await page.locator("#account-profiles-form").waitFor({ state: "visible" });
    const settings = await page.evaluate(() => fetch("/api/account-profiles", { cache: "no-store" }).then((response) => response.json()));
    assert.equal(await page.locator(`input[name="favorites-binding"][value="${settings.favoritesBinding}"]`).isChecked(), true);
    assert.match(await page.locator("#content-account-meta").innerText(), /Profile content-collector/);
    assert.match(await page.locator("#favorites-account-meta").innerText(), /Profile/);
    if (settings.roles.favorites.status.ready) {
      assert.equal(await page.locator('[data-account-role-card="favorites"]').evaluate((element) => element.classList.contains("is-ready")), true);
      assert.equal(await page.locator('[data-account-login="favorites"]').innerText(), "管理/切换账号");
    }
    await page.locator('.nav-item[data-view="tasks"]').click();
    assert.equal(await page.locator("#tasks-view").isVisible(), true);
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.locator("#tasks-view").isVisible(), true);
    assert.equal(await page.locator('.nav-item[data-view="tasks"]').evaluate((element) => element.classList.contains("is-active")), true);
    assert.equal(pageErrors.length, 0);
    console.log("account center ui ok");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
