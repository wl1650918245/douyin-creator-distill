/**
 * 收藏夹目录适配器。
 *
 * 只使用收藏夹账号的 Chrome Profile，通过登录态下的网页接口读取收藏夹目录。
 * 先 list-only 获取子文件夹，再按用户选择分页读取作品；不复用公开主页抓取器的账号。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const {
  acquireProfileLock,
  buildChromeLaunchArgs,
  ensureDir,
  findChromePath,
  getAccountAnalysisDir,
  resolveChromeProfile,
  saveJsonFile,
} = require("../../config/runtime-config");
const { resolveAccountRole } = require("../../config/account-profiles");
const { createVideoSnapshotFromAweme } = require("./profile-crawler");

function emitProgress(event) {
  console.log(`@@PROGRESS@@${JSON.stringify({ at: new Date().toISOString(), ...event })}`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = { listOnly: false, collectionIds: [], profile: null };
  for (const arg of argv) {
    if (arg === "--list-only") options.listOnly = true;
    if (arg.startsWith("--profile=")) options.profile = arg.slice("--profile=".length);
    if (arg.startsWith("--collection-ids=")) {
      options.collectionIds = arg.slice("--collection-ids=".length).split(",").map((id) => id.trim()).filter(Boolean);
    }
  }
  return options;
}

function asString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function collectionId(item) {
  const info = item?.collects_info || item?.collection_info || {};
  return asString(item?.collects_id_str || item?.collects_id || info.collects_id_str || info.collects_id || item?.id);
}

function collectionName(item, id) {
  const info = item?.collects_info || item?.collection_info || {};
  return asString(item?.name || item?.collects_name || item?.title || info.name || info.collects_name || `收藏夹 ${id}`);
}

function normalizeCollections(payload) {
  const items = Array.isArray(payload?.collects_list) ? payload.collects_list : [];
  const seen = new Set();
  return items.map((item) => {
    const id = collectionId(item);
    return {
      id,
      name: collectionName(item, id),
      count: Number(item?.count ?? item?.aweme_count ?? item?.video_count ?? item?.collects_count ?? 0) || 0,
    };
  }).filter((item) => item.id && !seen.has(item.id) && seen.add(item.id));
}

function unwrapAweme(item) {
  return item?.aweme_info || item?.aweme || item;
}

function mergeWork(existing, incoming, collection) {
  if (!existing) {
    const snapshot = createVideoSnapshotFromAweme(unwrapAweme(incoming));
    if (!snapshot) return null;
    return { ...snapshot, collectionIds: [collection.id], collectionNames: [collection.name] };
  }
  existing.collectionIds = [...new Set([...(existing.collectionIds || []), collection.id])];
  existing.collectionNames = [...new Set([...(existing.collectionNames || []), collection.name])];
  return existing;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function fetchJson(page, endpoint, params) {
  return page.evaluate(async ({ endpoint, params }) => {
    const query = new URLSearchParams(params);
    const response = await fetch(`${endpoint}?${query}`, { credentials: "include" });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`接口返回不是 JSON（HTTP ${response.status}）`); }
    if (!response.ok || (data?.status_code && Number(data.status_code) !== 0)) {
      throw new Error(`抖音接口返回失败（HTTP ${response.status}，状态 ${data?.status_code ?? "未知"}）`);
    }
    return data;
  }, { endpoint, params });
}

async function listCollections(page) {
  const result = [];
  const seen = new Set();
  let cursor = 0;
  for (let pageNumber = 1; pageNumber <= 50; pageNumber += 1) {
    emitProgress({ stage: "listing_collections", label: "正在读取收藏夹目录", detail: `第 ${pageNumber} 页`, discovered: result.length });
    const payload = await fetchJson(page, "/aweme/v1/web/collects/list/", {
      device_platform: "webapp", aid: "6383", channel: "channel_pc_web", cursor: String(cursor), count: "20",
    });
    const pageItems = normalizeCollections(payload);
    pageItems.forEach((item) => {
      if (!seen.has(item.id)) { seen.add(item.id); result.push(item); }
    });
    const hasMore = Boolean(payload?.has_more);
    const nextCursor = Number(payload?.cursor ?? payload?.max_cursor ?? cursor) || 0;
    if (!hasMore || nextCursor === cursor || !pageItems.length) break;
    cursor = nextCursor;
  }
  return result;
}

async function listCollectionWorks(page, collection, workMap, stats) {
  let cursor = 0;
  for (let pageNumber = 1; pageNumber <= 200; pageNumber += 1) {
    emitProgress({ stage: "fetching_collection", label: `正在读取${collection.name}`, detail: `第 ${pageNumber} 页 · 已去重 ${workMap.size} 条`, discovered: workMap.size });
    const payload = await fetchJson(page, "/aweme/v1/web/collects/video/list/", {
      device_platform: "webapp", aid: "6383", channel: "channel_pc_web", collects_id: collection.id, cursor: String(cursor), count: "20",
    });
    const items = Array.isArray(payload?.aweme_list) ? payload.aweme_list : [];
    items.forEach((item) => {
      const id = asString(unwrapAweme(item)?.aweme_id);
      if (!id) return;
      const previous = workMap.get(id);
      const merged = mergeWork(previous, item, collection);
      if (!merged) return;
      if (!previous) workMap.set(id, merged); else stats.duplicates += 1;
    });
    const hasMore = Boolean(payload?.has_more);
    const nextCursor = Number(payload?.cursor ?? payload?.max_cursor ?? cursor) || 0;
    if (!hasMore || nextCursor === cursor || !items.length) break;
    cursor = nextCursor;
  }
}

function outputPath(listOnly) {
  const directory = getAccountAnalysisDir("favorites");
  ensureDir(directory);
  return path.join(directory, `${listOnly ? "collections" : "favorites"}-${timestamp()}.json`);
}

async function run() {
  const options = parseArgs();
  const account = resolveAccountRole("favorites");
  const profile = resolveChromeProfile(options.profile || account.profilePath);
  const lock = acquireProfileLock(profile.profilePath);
  let context;
  try {
    emitProgress({ stage: "starting_profile", label: "启动收藏夹账号 Profile", detail: account.shared ? "复用内容采集账号登录态" : "使用独立收藏夹账号登录态" });
    context = await chromium.launchPersistentContext(profile.userDataDir, {
      headless: false,
      executablePath: findChromePath(),
      args: buildChromeLaunchArgs(profile.profileDirectory),
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://www.douyin.com/", { waitUntil: "domcontentloaded", timeout: 120000 });
    emitProgress({ stage: "opening_favorites", label: "已打开收藏夹账号", detail: "正在验证登录态" });
    const collections = await listCollections(page);
    if (!collections.length) throw new Error("没有读取到收藏夹目录；请确认收藏夹账号已登录，且页面可以正常访问抖音");
    if (options.listOnly) {
      const filepath = outputPath(true);
      saveJsonFile(filepath, {
        schemaVersion: "1.0",
        exportedAt: new Date().toISOString(),
        source: "favorites",
        sourceMode: "favorites",
        accountRole: "favorites",
        profileId: account.profileId,
        collections,
        totals: { collectionCount: collections.length, allWorks: 0, selectedWorks: 0, videoCount: 0, imageCount: 0, duplicates: 0 },
        works: [],
        audit: { status: "pending_selection", reason: "收藏夹目录已获取，等待用户选择子文件夹" },
      });
      emitProgress({ stage: "collections_ready", label: "收藏夹目录已获取，等待选择", discovered: collections.length, outputPath: filepath });
      console.log(`收藏夹目录已导出: ${filepath}`);
      return;
    }
    const selected = options.collectionIds.includes("all") ? collections : collections.filter((item) => options.collectionIds.includes(item.id));
    if (!selected.length) throw new Error("没有选择有效的收藏夹；请先读取目录，再选择一个或多个子文件夹");
    emitProgress({ stage: "collections_selected", label: "已确认收藏夹范围", detail: selected.map((item) => item.name).join("、") });
    const workMap = new Map();
    const stats = { duplicates: 0 };
    for (const collection of selected) await listCollectionWorks(page, collection, workMap, stats);
    const works = [...workMap.values()];
    if (!works.length) throw new Error("所选收藏夹没有读取到作品，原始目录不会被伪造成空结果");
    const filepath = outputPath(false);
    const data = {
      schemaVersion: "1.0",
      exportedAt: new Date().toISOString(),
      source: "favorites",
      sourceMode: "favorites",
      accountRole: "favorites",
      profileId: account.profileId,
      collections: selected,
      pageTotal: null,
      totals: {
        collectionCount: selected.length,
        allWorks: works.length,
        selectedWorks: works.length,
        videoCount: works.filter((work) => work.contentType === "video").length,
        imageCount: works.filter((work) => work.contentType === "image").length,
        duplicates: stats.duplicates,
      },
      works,
      sourceContext: { sourceMode: "favorites", accountRole: "favorites", profileId: account.profileId },
    };
    emitProgress({ stage: "exporting_json", label: "导出收藏夹 JSON", discovered: works.length, detail: `${selected.length} 个收藏夹，跨文件夹去重 ${stats.duplicates} 条` });
    saveJsonFile(filepath, data);
    console.log(`自媒体分析数据已导出: ${filepath}`);
    emitProgress({ stage: "json_exported", label: "JSON 已导出，等待本地审核", discovered: works.length, outputPath: filepath });
  } finally {
    if (context && !context.isClosed()) await context.close().catch(() => {});
    lock.release();
  }
}

if (require.main === module) run().catch((error) => { console.error(`收藏夹抓取失败: ${error.message}`); process.exitCode = 1; });

module.exports = { normalizeCollections, parseArgs, run };
