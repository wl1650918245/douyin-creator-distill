const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  RUNTIME_DIR,
  acquireProfileLockWithRetry,
  buildChromeLaunchArgs,
  ensureDir,
  findChromePath,
  resolveChromeProfile,
} = require("../../config/runtime-config");
const { resolveAccountRole } = require("../../config/account-profiles");

let cookieExportQueue = Promise.resolve();

function toNetscapeCookie(cookie) {
  const httpOnlyPrefix = cookie.httpOnly ? "#HttpOnly_" : "";
  const domain = `${httpOnlyPrefix}${cookie.domain}`;
  const includeSubdomains = cookie.domain.startsWith(".") ? "TRUE" : "FALSE";
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expires = Number.isFinite(cookie.expires) && cookie.expires > 0 ? Math.floor(cookie.expires) : 0;
  return [domain, includeSubdomains, cookie.path || "/", secure, expires, cookie.name, cookie.value].join("\t");
}

async function runCookieExport(role) {
  const account = resolveAccountRole(role);
  const profile = resolveChromeProfile(account.profilePath);
  const lock = await acquireProfileLockWithRetry(profile.profilePath);
  let context;
  try {
    context = await chromium.launchPersistentContext(profile.userDataDir, {
      executablePath: findChromePath(),
      headless: false,
      args: buildChromeLaunchArgs(profile.profileDirectory),
      viewport: null,
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2000);
    const cookies = await context.cookies(["https://www.douyin.com/"]);
    if (!cookies.length) throw new Error("专用抖音浏览器没有可用 Cookie，请先在抖音连接中完成登录。");
    const directory = path.join(RUNTIME_DIR, "cookies");
    ensureDir(directory);
    const filepath = path.join(directory, `douyin-cookies-${account.profileId}.txt`);
    const content = ["# Netscape HTTP Cookie File", ...cookies.map(toNetscapeCookie), ""].join("\n");
    fs.writeFileSync(filepath, content, { encoding: "utf8", mode: 0o600 });
    return filepath;
  } finally {
    if (context) await context.close().catch(() => {});
    lock.release();
  }
}

function exportDouyinCookies(role = "content") {
  const operation = cookieExportQueue.catch(() => {}).then(() => runCookieExport(role));
  cookieExportQueue = operation.catch(() => {});
  return operation;
}

module.exports = { exportDouyinCookies };
