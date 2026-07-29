/**
 * profile-crawler.js
 *
 * 通过抖音号/账号名自动获取博主作品并导出分析 JSON
 *
 * 工作流：打开抖音首页 -> 搜索框搜索账号 -> 点击博主卡片 -> 提取作品 -> 导出分析 JSON
 *
 * 包含高级反检测措施，保护账号安全
 *
 * 用法:
 *   npm run crawl:profile -- <douyin_id> [options]
 *
 *   参数:
 *   <douyin_id>          抖音号、账号名、或主页链接中的ID
 *
 *   选项:
 *   --limit=<N>           最多保留前 N 条作品 (默认: 0，不截断)
 *   --days=<N>            只获取最近 N 天内的视频
 *   --date=<YYYY-MM-DD>   获取指定日期及之后的视频
 *   --min-likes=<N>       只获取点赞数 >= N 的视频
 *   --sort-by=<field>     按日期、点赞、评论、收藏、分享或总互动排序
 *   --sort-order=<asc|desc> 升序或降序 (默认: desc)
 *   --skip-existing       跳过已有笔记的视频 (默认: true)
 *   --no-skip             不跳过已处理视频
 *   --include-images      包含图文/非标准视频作品 (默认开启)
 *   --videos-only         只保留视频
 *   --exclude-images      --videos-only 的别名
 *   --alt-profile          使用备用 Chrome Profile (避免与主浏览器冲突)
 *   --dry                 预览模式
 *
 * 示例:
 *   npm run crawl:profile -- MS4wLjABAAAAxxx --limit=20
 *   npm run crawl:profile -- 姜胡说 --days=30
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const {
  ALT_CHROME_PROFILE,
  DEFAULT_CHROME_PROFILE,
  PROCESSED_VIDEOS_STATE_FILE,
  TEMP_CHROME_PROFILE,
  acquireProfileLock,
  buildChromeLaunchArgs,
  findChromePath,
  getAccountAnalysisDir,
  loadJsonFile,
  resolveChromeProfile,
  sanitizeAccountSlug,
  saveJsonFile,
} = require('../../config/runtime-config');

// Machine-readable events are consumed by the local task UI. Keep normal logs for diagnosis.
function emitProgress(event) {
  console.log(`@@PROGRESS@@${JSON.stringify({ at: new Date().toISOString(), ...event })}`);
}

// 反检测插件
let stealthPlugin;
try {
  stealthPlugin = require('puppeteer-extra-plugin-stealth')();
} catch (e) {
  console.log('注意: puppeteer-extra-plugin-stealth 未安装，反检测功能受限');
}


// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    douyinId: null,
    url: null,          // 直接访问的URL
    limit: 0,           // 0 = 获取所有视频
    days: null,
    date: null,
    minLikes: 0,
    skipExisting: true,
    dry: false,
    profile: null,
    sortBy: null,      // 'date' | 'likes'
    sortOrder: 'desc', // 'asc' | 'desc'
    includeImages: true,
    useDirectApi: true,
    apiSupplementOnly: false,
    disableSearchApi: false,
    incrementalBaselinePath: null,
  };

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      options.limit = parseInt(arg.replace('--limit=', ''), 10);
    } else if (arg.startsWith('--days=')) {
      options.days = parseInt(arg.replace('--days=', ''), 10);
    } else if (arg.startsWith('--date=')) {
      options.date = arg.replace('--date=', '');
    } else if (arg.startsWith('--min-likes=')) {
      options.minLikes = parseInt(arg.replace('--min-likes=', ''), 10);
    } else if (arg.startsWith('--sort-by=')) {
      const val = arg.replace('--sort-by=', '').toLowerCase();
      if (['date', 'likes', 'comments', 'collects', 'shares', 'interactions'].includes(val)) {
        options.sortBy = val;
      }
    } else if (arg.startsWith('--sort-order=')) {
      const val = arg.replace('--sort-order=', '').toLowerCase();
      if (['asc', 'desc'].includes(val)) {
        options.sortOrder = val;
      }
    } else if (arg === '--skip-existing') {
      options.skipExisting = true;
    } else if (arg === '--no-skip') {
      options.skipExisting = false;
    } else if (arg === '--dry') {
      options.dry = true;
    } else if (arg === '--include-images') {
      options.includeImages = true;
    } else if (arg === '--videos-only' || arg === '--exclude-images') {
      options.includeImages = false;
    } else if (arg === '--alt-profile' || arg === '--alt') {
      options.profile = ALT_CHROME_PROFILE;
    } else if (arg === '--temp-profile') {
      options.profile = TEMP_CHROME_PROFILE;
    } else if (arg.startsWith('--profile=')) {
      options.profile = arg.replace('--profile=', '');
    } else if (arg.startsWith('--url=')) {
      options.url = arg.replace('--url=', '');
    } else if (arg === '--no-direct-api') {
      options.useDirectApi = false;
    } else if (arg === '--api-supplement') {
      options.useDirectApi = true;
      options.apiSupplementOnly = true;
    } else if (arg === '--no-search-api') {
      options.disableSearchApi = true;
    } else if (arg.startsWith('--incremental-baseline=')) {
      options.incrementalBaselinePath = arg.slice('--incremental-baseline='.length);
    } else if (!arg.startsWith('--') && !options.douyinId) {
      options.douyinId = arg;
    }
  }

  return options;
}

// 检测短链接重定向
function resolveShortUrl(shortUrl) {
  return new Promise((resolve, reject) => {
    const protocol = shortUrl.startsWith('https') ? https : http;
    const urlObj = new URL(shortUrl);

    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    };

    const req = protocol.request(options, (res) => {
      if (res.headers.location) {
        resolve(res.headers.location);
      } else {
        resolve(shortUrl);
      }
    });

    req.on('error', reject);
    req.end();
  });
}

// 加载已处理记录
function loadProcessedState() {
  const stateFile = PROCESSED_VIDEOS_STATE_FILE;
  try {
    if (fs.existsSync(stateFile)) {
      const data = loadJsonFile(stateFile, null);
      if (!data) {
        return { processedUrls: new Set(), processedVideoIds: new Set() };
      }
      return {
        processedUrls: new Set(data.processedUrls || []),
        processedVideoIds: new Set(data.processedVideoIds || [])
      };
    }
  } catch (e) {}
  return { processedUrls: new Set(), processedVideoIds: new Set() };
}

// 保存已处理记录
function saveProcessedState(state) {
  const stateFile = PROCESSED_VIDEOS_STATE_FILE;
  try {
    saveJsonFile(stateFile, {
      processedUrls: Array.from(state.processedUrls),
      processedVideoIds: Array.from(state.processedVideoIds),
      lastUpdate: new Date().toISOString()
    });
  } catch (e) {}
}

// 随机延迟（模拟人类行为）
async function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min)) + min;
  await new Promise(r => setTimeout(r, delay));
}

// 检查页面是否仍然活跃（未被关闭）
async function safePageAlive(page) {
  try {
    if (!page || page.isClosed()) return false;
    await page.title(); // 尝试获取标题以确认页面可用
    return true;
  } catch (e) {
    return false;
  }
}

async function hasVisibleVerificationChallenge(page) {
  if (!(await safePageAlive(page))) return false;
  return page.evaluate(() => {
    const candidates = [
      document.querySelector('#captcha_container'),
      ...document.querySelectorAll('iframe[src*="verifycenter"], iframe[src*="captcha"]')
    ].filter(Boolean);
    return candidates.some((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    });
  }).catch(() => false);
}

async function waitForVerificationChallenge(page, timeoutMs = 180000) {
  if (!(await hasVisibleVerificationChallenge(page))) return false;
  const startedAt = Date.now();
  console.log('检测到抖音安全验证，请在已打开的浏览器中完成验证；完成后任务会自动继续。');
  emitProgress({
    stage: 'verification_required',
    label: '等待你完成抖音安全验证',
    detail: '请在已打开的浏览器中完成验证码；完成后任务会自动继续'
  });
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    if (!(await safePageAlive(page))) throw new Error('抖音安全验证窗口已关闭，请重新抓取');
    if (!(await hasVisibleVerificationChallenge(page))) {
      console.log('抖音安全验证已完成，继续抓取。');
      emitProgress({
        stage: 'verification_completed',
        label: '安全验证已完成，继续抓取',
        detail: '正在重新读取搜索结果'
      });
      await randomDelay(1200, 2000);
      return true;
    }
  }
  throw new Error('抖音安全验证在 3 分钟内未完成，请完成验证后重新抓取');
}

// 解析相对日期文本为实际日期字符串
// 支持: "3天前", "1周前", "2月前", "1年前", "刚刚", "今天"
function parseRelativeDate(text) {
  if (!text) return '';
  const now = new Date();

  // 刚刚/今天
  if (text.includes('刚刚') || text.includes('今天') || text.includes('方才')) {
    return now.toISOString().substring(0, 10);
  }

  // 分钟前
  const minMatch = text.match(/(\d+)\s*分钟前/);
  if (minMatch) {
    const mins = parseInt(minMatch[1]);
    const date = new Date(now.getTime() - mins * 60 * 1000);
    return date.toISOString().substring(0, 10);
  }

  // 小时前
  const hourMatch = text.match(/(\d+)\s*小时前/);
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]);
    const date = new Date(now.getTime() - hours * 60 * 60 * 1000);
    return date.toISOString().substring(0, 10);
  }

  // 天前
  const dayMatch = text.match(/(\d+)\s*天前/);
  if (dayMatch) {
    const days = parseInt(dayMatch[1]);
    const date = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return date.toISOString().substring(0, 10);
  }

  // 周前
  const weekMatch = text.match(/(\d+)\s*周前/);
  if (weekMatch) {
    const weeks = parseInt(weekMatch[1]);
    const date = new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000);
    return date.toISOString().substring(0, 10);
  }

  // months ago
  const monthMatch = text.match(/(\d+)\s*(?:\u4e2a)?\u6708\u524d/);
  if (monthMatch) {
    const months = parseInt(monthMatch[1]);
    const date = new Date(now);
    date.setMonth(date.getMonth() - months);
    return date.toISOString().substring(0, 10);
  }

  // years ago
  const yearMatch = text.match(/(\d+)\s*\u5e74\u524d/);
  if (yearMatch) {
    const years = parseInt(yearMatch[1]);
    const date = new Date(now);
    date.setFullYear(date.getFullYear() - years);
    return date.toISOString().substring(0, 10);
  }

  return '';
}

const SCRAPE_MODES = {
  fast: {
    maxScrolls: 220,
    idleRounds: 8,
    minRoundsBeforeStop: 12,
    stepMinRatio: 0.18,
    stepMaxRatio: 0.42,
    waitMinMs: 2600,
    waitMaxMs: 3600,
  },
  safe: {
    maxScrolls: 420,
    idleRounds: 16,
    minRoundsBeforeStop: 20,
    stepMinRatio: 0.1,
    stepMaxRatio: 0.24,
    waitMinMs: 3600,
    waitMaxMs: 5200,
  },
};

function parseLikeCount(rawText) {
  const text = String(rawText || '').replace(/\s+/g, '').toLowerCase();
  const match = text.match(/([\d.]+)\s*([a-zA-Z\u4e07\u4ebf\u5343\u767e]?)/);
  if (!match) {
    return 0;
  }

  let value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }

  const unit = match[2];
  if (unit === 'w' || unit === 'W' || unit === '\u4e07') {
    value *= 10000;
  } else if (unit === '\u4ebf') {
    value *= 100000000;
  } else if (unit === '\u5343' || unit === 'k' || unit === 'K') {
    value *= 1000;
  } else if (unit === '\u767e') {
    value *= 100;
  }

  return Math.round(value);
}

function pickMaxNumber(...values) {
  const nums = values.filter((value) => Number.isFinite(value) && value >= 0);
  if (nums.length === 0) {
    return 0;
  }
  return Math.max(...nums);
}

function normalizeCount(value) {
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

function extractHashtags(text) {
  const source = String(text || '');
  const matches = source.match(/#[^#\s]+/g) || [];
  return Array.from(new Set(matches.map((tag) => tag.trim())));
}

function extractMentions(text) {
  const source = String(text || '');
  const matches = source.match(/@[^@\s]+/g) || [];
  return Array.from(new Set(matches.map((name) => name.trim())));
}

function summarizeTopVideos(videos, metric, limit = 10) {
  return [...videos]
    .sort((a, b) => pickMaxNumber(b[metric]) - pickMaxNumber(a[metric]))
    .slice(0, limit)
    .map((video) => ({
      videoId: video.videoId,
      title: video.title || '',
      shareUrl: video.shareUrl || '',
      date: video.date || '',
      [metric]: pickMaxNumber(video[metric]),
      interactionTotal: pickMaxNumber(video.interactionTotal),
      contentType: video.contentType || 'video',
    }));
}

function buildAnalysisSummary(videos) {
  const totals = {
    likes: 0,
    comments: 0,
    collects: 0,
    shares: 0,
    interactions: 0,
  };
  const hashtagCounts = new Map();
  const mentionCounts = new Map();

  for (const video of videos) {
    totals.likes += pickMaxNumber(video.likes);
    totals.comments += pickMaxNumber(video.commentCount);
    totals.collects += pickMaxNumber(video.collectCount);
    totals.shares += pickMaxNumber(video.shareCount);
    totals.interactions += pickMaxNumber(video.interactionTotal);

    for (const tag of video.hashtags || []) {
      hashtagCounts.set(tag, (hashtagCounts.get(tag) || 0) + 1);
    }
    for (const mention of video.mentions || []) {
      mentionCounts.set(mention, (mentionCounts.get(mention) || 0) + 1);
    }
  }

  const topTags = [...hashtagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  const topMentions = [...mentionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([mention, count]) => ({ mention, count }));

  return {
    totals,
    topByLikes: summarizeTopVideos(videos, 'likes'),
    topByComments: summarizeTopVideos(videos, 'commentCount'),
    topByCollects: summarizeTopVideos(videos, 'collectCount'),
    topByShares: summarizeTopVideos(videos, 'shareCount'),
    topByInteractions: summarizeTopVideos(videos, 'interactionTotal'),
    topHashtags: topTags,
    topMentions,
  };
}

function exportAnalysisBundle(douyinId, profileUrl, allVideos, filteredVideos, options, pageTotal) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const accountSlug = sanitizeAccountSlug(douyinId || profileUrl || 'douyin');
  const accountDir = getAccountAnalysisDir(accountSlug);
  const filepath = path.join(accountDir, `${accountSlug}-${timestamp}.json`);
  const payload = {
    exportedAt: new Date().toISOString(),
    accountSlug,
    douyinId: douyinId || '',
    profileUrl: profileUrl || '',
    pageTotal: Number.isFinite(pageTotal) ? pageTotal : null,
    options: {
      limit: options.limit || 0,
      days: options.days || null,
      date: options.date || null,
      minLikes: options.minLikes || 0,
      sortBy: options.sortBy || null,
      sortOrder: options.sortOrder || 'desc',
      includeImages: options.includeImages !== false,
      dry: Boolean(options.dry),
      acquisitionMode: options.apiSupplementOnly ? 'api_supplement' : options.useDirectApi ? 'hybrid' : 'browser',
      incremental: Boolean(options.incrementalBaselinePath),
    },
    totals: {
      allWorks: allVideos.length,
      selectedWorks: filteredVideos.length,
      videos: filteredVideos.filter((video) => video.contentType !== 'image').length,
      imagePosts: filteredVideos.filter((video) => video.contentType === 'image').length,
    },
    summary: buildAnalysisSummary(filteredVideos),
    works: filteredVideos,
  };

  fs.mkdirSync(accountDir, { recursive: true });
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
  return filepath;
}

function buildVideoRecord(videoId, partial = {}) {
  return {
    videoId,
    videoUrl: partial.videoUrl || `https://www.douyin.com/video/${videoId}`,
    shareUrl: partial.shareUrl || `https://v.douyin.com/${videoId}/`,
    title: partial.title || '',
    desc: partial.desc || partial.title || '',
    date: partial.date || '',
    likes: partial.likes || 0,
    commentCount: partial.commentCount || 0,
    collectCount: partial.collectCount || 0,
    shareCount: partial.shareCount || 0,
    playCount: partial.playCount || 0,
    awemeType: partial.awemeType || 0,
    durationMs: partial.durationMs || 0,
    hasImages: Boolean(partial.hasImages),
    contentType: partial.contentType || 'video',
    publishTimestamp: partial.publishTimestamp || null,
    authorNickname: partial.authorNickname || '',
    authorSecUserId: partial.authorSecUserId || '',
    authorUid: partial.authorUid || '',
    authorAvatarUrl: partial.authorAvatarUrl || '',
    hashtags: Array.isArray(partial.hashtags) ? partial.hashtags : [],
    mentions: Array.isArray(partial.mentions) ? partial.mentions : [],
    interactionTotal: partial.interactionTotal || 0,
    acquisitionSources: [...new Set(partial.acquisitionSources || [])],
  };
}

function mergeVideoSnapshot(videoMap, snapshot) {
  if (!snapshot || !snapshot.videoId) {
    return false;
  }

  const current = videoMap.get(snapshot.videoId);
  if (!current) {
    videoMap.set(snapshot.videoId, buildVideoRecord(snapshot.videoId, snapshot));
    return true;
  }

  if ((!current.title || current.title.length < (snapshot.title || '').length) && snapshot.title) {
    current.title = snapshot.title;
  }
  if ((!current.desc || current.desc.length < (snapshot.desc || '').length) && snapshot.desc) {
    current.desc = snapshot.desc;
  }
  if (!current.shareUrl && snapshot.shareUrl) {
    current.shareUrl = snapshot.shareUrl;
  }
  if (!current.videoUrl && snapshot.videoUrl) {
    current.videoUrl = snapshot.videoUrl;
  }
  if (!current.date && snapshot.date) {
    current.date = snapshot.date;
  }
  if ((snapshot.likes || 0) > (current.likes || 0)) {
    current.likes = snapshot.likes;
  }
  current.commentCount = pickMaxNumber(current.commentCount, snapshot.commentCount);
  current.collectCount = pickMaxNumber(current.collectCount, snapshot.collectCount);
  current.shareCount = pickMaxNumber(current.shareCount, snapshot.shareCount);
  current.playCount = pickMaxNumber(current.playCount, snapshot.playCount);
  if ((snapshot.durationMs || 0) > (current.durationMs || 0)) {
    current.durationMs = snapshot.durationMs;
  }
  if (!current.hasImages && snapshot.hasImages) {
    current.hasImages = true;
  }
  if ((current.contentType === 'image' || !current.contentType) && snapshot.contentType) {
    current.contentType = snapshot.contentType;
  }
  if (!current.awemeType && snapshot.awemeType) {
    current.awemeType = snapshot.awemeType;
  }
  if (!current.publishTimestamp && snapshot.publishTimestamp) {
    current.publishTimestamp = snapshot.publishTimestamp;
  }
  if (!current.authorNickname && snapshot.authorNickname) {
    current.authorNickname = snapshot.authorNickname;
  }
  if (!current.authorSecUserId && snapshot.authorSecUserId) {
    current.authorSecUserId = snapshot.authorSecUserId;
  }
  if (!current.authorUid && snapshot.authorUid) {
    current.authorUid = snapshot.authorUid;
  }
  if (!current.authorAvatarUrl && snapshot.authorAvatarUrl) {
    current.authorAvatarUrl = snapshot.authorAvatarUrl;
  }
  if ((snapshot.hashtags || []).length > 0) {
    current.hashtags = Array.from(new Set([...(current.hashtags || []), ...snapshot.hashtags]));
  }
  if ((snapshot.mentions || []).length > 0) {
    current.mentions = Array.from(new Set([...(current.mentions || []), ...snapshot.mentions]));
  }
  current.interactionTotal = pickMaxNumber(
    current.interactionTotal,
    snapshot.interactionTotal,
    normalizeCount(current.likes) +
      normalizeCount(current.commentCount) +
      normalizeCount(current.collectCount) +
      normalizeCount(current.shareCount)
  );
  current.acquisitionSources = [...new Set([
    ...(current.acquisitionSources || []),
    ...(snapshot.acquisitionSources || []),
  ])];

  return false;
}

function firstImageUrl(image) {
  return Array.isArray(image?.url_list) ? String(image.url_list.find(Boolean) || '') : '';
}

function createVideoSnapshotFromAweme(aweme, acquisitionSource = '') {
  const videoId = aweme?.aweme_id;
  if (!videoId) {
    return null;
  }

  const createTime = Number(aweme.create_time || 0);
  const date = createTime > 0
    ? new Date(createTime * 1000).toISOString().substring(0, 10)
    : '';
  const hasImages = Boolean(aweme?.images?.length || aweme?.image_infos?.length);
  const durationMs = Number(aweme?.video?.duration || 0);
  const awemeType = Number(aweme?.aweme_type || 0);
  const contentType = hasImages || durationMs === 0 ? 'image' : 'video';
  const desc = (aweme.desc || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const commentCount = Number(aweme.statistics?.comment_count || 0);
  const collectCount = Number(aweme.statistics?.collect_count || 0);
  const shareCount = Number(aweme.statistics?.share_count || 0);
  const playCount = Number(aweme.statistics?.play_count || 0);
  const author = aweme?.author || {};
  const authorSecUserId = findFirstSecUserId(author) || '';

  return {
    videoId,
    videoUrl: `https://www.douyin.com/video/${videoId}`,
    shareUrl: aweme.share_url || `https://www.douyin.com/video/${videoId}`,
    title: desc.slice(0, 200),
    desc,
    date,
    likes: Number(aweme.statistics?.digg_count || 0),
    commentCount,
    collectCount,
    shareCount,
    playCount,
    awemeType,
    durationMs,
    hasImages,
    contentType,
    publishTimestamp: createTime > 0 ? createTime * 1000 : null,
    authorNickname: String(author.nickname || ''),
    authorSecUserId,
    authorUid: String(author.uid || ''),
    authorAvatarUrl: firstImageUrl(author.avatar_thumb) || firstImageUrl(author.avatar_medium) || firstImageUrl(author.avatar_larger),
    hashtags: extractHashtags(desc),
    mentions: extractMentions(desc),
    interactionTotal:
      Number(aweme.statistics?.digg_count || 0) +
      commentCount +
      collectCount +
      shareCount,
    acquisitionSources: acquisitionSource ? [acquisitionSource] : [],
  };
}

function attachAwemePostCollector(page, videoMap, targetSecUserId = null) {
  const state = {
    responseCount: 0,
    hasMore: null,
    maxCursor: null,
    newVideosSinceLastRead: 0,
    apiVideoIds: new Set(),
  };

  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes('/aweme/v1/web/aweme/post/')) {
      return;
    }
    if (targetSecUserId && !url.includes(`sec_user_id=${encodeURIComponent(targetSecUserId)}`)) {
      return;
    }

    try {
      const payload = await response.json();
      const awemeList = Array.isArray(payload?.aweme_list) ? payload.aweme_list : [];
      state.responseCount += 1;
      state.hasMore = Boolean(payload?.has_more);
      state.maxCursor = payload?.max_cursor ?? null;

      for (const aweme of awemeList) {
        const snapshot = createVideoSnapshotFromAweme(aweme, 'browser_network');
        if (snapshot?.videoId) {
          state.apiVideoIds.add(snapshot.videoId);
        }
        if (snapshot && mergeVideoSnapshot(videoMap, snapshot)) {
          state.newVideosSinceLastRead += 1;
        }
      }
    } catch (error) {
      console.log(`  [api] failed to parse aweme/post response: ${error.message}`);
    }
  };

  page.on('response', onResponse);

  return {
    state,
    consumeNewVideos() {
      const count = state.newVideosSinceLastRead;
      state.newVideosSinceLastRead = 0;
      return count;
    },
    dispose() {
      page.off('response', onResponse);
    },
  };
}

async function hydrateVideosFromPageData(page, videoMap, targetSecUserId = null) {
  const snapshot = await page.evaluate(() => {
    const result = {
      workCount: null,
      awemeItems: [],
    };
    const seenIds = new Set();

    const parseWorkCount = (text) => {
      const normalized = String(text || '').replace(/\s+/g, ' ').trim();
      const match = normalized.match(/作品\s*(\d{1,6})/);
      if (!match) {
        return null;
      }
      const count = Number(match[1]);
      return Number.isFinite(count) ? count : null;
    };

    const collectAweme = (value) => {
      if (!value || typeof value !== 'object') {
        return;
      }

      if (typeof value.aweme_id === 'string' && !seenIds.has(value.aweme_id)) {
        seenIds.add(value.aweme_id);
        result.awemeItems.push(value);
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          collectAweme(item);
        }
        return;
      }

      for (const nested of Object.values(value)) {
        if (nested && typeof nested === 'object') {
          collectAweme(nested);
        }
      }
    };

    const countCandidates = Array.from(document.querySelectorAll('[role="tab"], button, span, div'))
      .map((node) => parseWorkCount(node.textContent))
      .filter((count) => Number.isFinite(count) && count > 0);

    if (countCandidates.length > 0) {
      result.workCount = Math.max(...countCandidates);
    }

    const scriptContents = Array.from(document.scripts)
      .map((script) => script.textContent || '')
      .filter((text) => text.includes('aweme') || text.includes('post') || text.includes('作品'));

    for (const content of scriptContents) {
      if (result.workCount == null) {
        const scriptCount = parseWorkCount(content);
        if (scriptCount != null && scriptCount > 0) {
          result.workCount = scriptCount;
        }
      }

      try {
        collectAweme(JSON.parse(content));
      } catch (error) {}
    }

    return result;
  });

  for (const aweme of snapshot.awemeItems) {
    const awemeSecUserId = findFirstSecUserId(aweme?.author || aweme);
    if (targetSecUserId && awemeSecUserId && awemeSecUserId !== targetSecUserId) {
      continue;
    }
    const video = createVideoSnapshotFromAweme(aweme, 'browser_page_data');
    if (video) {
      mergeVideoSnapshot(videoMap, video);
    }
  }

  return {
    workCount: snapshot.workCount,
    hydratedCount: snapshot.awemeItems.length,
  };
}

async function collectVisibleVideoCards(page) {
  const records = await page.$$eval('a[href]', (links) => {
    const normalizeHref = (href) => {
      if (!href) {
        return null;
      }

      const videoMatch = href.match(/\/video\/(\d+)/);
      if (videoMatch) {
        const videoId = videoMatch[1];
        return {
          videoId,
          videoUrl: `https://www.douyin.com/video/${videoId}`,
          shareUrl: href.split('?')[0],
        };
      }

      const shortMatch = href.match(/v\.douyin\.com\/([^\/?#]+)/);
      if (shortMatch) {
        const shortCode = shortMatch[1];
        return {
          videoId: shortCode,
          videoUrl: '',
          shareUrl: href.split('?')[0].replace(/\/$/, ''),
        };
      }

      return null;
    };

    const snapshots = [];

    for (const link of links) {
      const normalized = normalizeHref(link?.href);
      if (!normalized?.videoId) {
        continue;
      }

      const item =
        link.closest('li') ||
        link.closest('[class*="card"]') ||
        link.closest('[class*="work"]') ||
        link.closest('[class*="video"]') ||
        link.parentElement;

      const titleCandidates = [
        item?.querySelector('p'),
        item?.querySelector('[class*="title"]'),
        item?.querySelector('[data-e2e*="title"]'),
        item?.querySelector('span'),
        link,
      ].filter(Boolean);
      const title =
        titleCandidates
          .map((node) => node.textContent?.trim() || '')
          .find((value) => value.length >= 2) || '';

      const likeNode = item?.querySelector('[class*="like"], [data-e2e*="like"], [class*="favor"]');
      const dateNode = item?.querySelector('time, [datetime], [class*="date"], [data-e2e*="publish"]');

      snapshots.push({
        videoId: normalized.videoId,
        videoUrl: normalized.videoUrl,
        shareUrl: normalized.shareUrl,
        title: title.replace(/\s+/g, ' ').slice(0, 200),
        date: dateNode?.textContent?.trim() || dateNode?.getAttribute?.('datetime') || '',
        likesText: likeNode?.textContent?.trim() || '',
      });
    }

    return snapshots;
  });

  return records.map((record) => ({
    videoId: record.videoId,
    videoUrl: record.videoUrl,
    shareUrl: record.shareUrl,
    title: record.title,
    date: record.date,
    likes: parseLikeCount(record.likesText),
    acquisitionSources: ['browser_dom'],
  }));
}

async function ensureWorksTab(page) {
  const selectors = [
    'div[role="tab"]:has-text("作品")',
    'button:has-text("作品")',
    'text=作品',
  ];

  for (const selector of selectors) {
    try {
      const tab = page.locator(selector).first();
      if (await tab.count()) {
        await tab.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1500);
        return true;
      }
    } catch (error) {}
  }

  return false;
}

async function getScrollMetrics(page) {
  return page.evaluate(() => {
    const scroller =
      document.querySelector('#main-scroll, .main-scroll, [class*="scroll-container"], [class*="mainContainer"]') ||
      document.querySelector('[class*="videoList"], [class*="video-list"], ul[class*="video"]');

    if (scroller) {
      return {
        target: 'container',
        top: scroller.scrollTop || 0,
        height: scroller.clientHeight || 0,
        scrollHeight: scroller.scrollHeight || 0,
      };
    }

    const doc = document.scrollingElement || document.documentElement || document.body;
    return {
      target: 'window',
      top: window.scrollY || doc.scrollTop || 0,
      height: window.innerHeight || doc.clientHeight || 0,
      scrollHeight: doc.scrollHeight || document.body?.scrollHeight || 0,
    };
  });
}

async function performIncrementalScroll(page, round, modeConfig) {
  const ratio =
    round % 6 === 5
      ? Math.min(modeConfig.stepMaxRatio + 0.08, 0.55)
      : modeConfig.stepMinRatio + Math.random() * (modeConfig.stepMaxRatio - modeConfig.stepMinRatio);

  return page.evaluate(({ ratio }) => {
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 900;
    const amount = Math.max(120, Math.floor(viewportHeight * ratio));

    const scroller =
      document.querySelector('#main-scroll, .main-scroll, [class*="scroll-container"], [class*="mainContainer"]') ||
      document.querySelector('[class*="videoList"], [class*="video-list"], ul[class*="video"]');

    if (scroller) {
      scroller.scrollTop += amount;
      scroller.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          view: window,
          deltaY: amount,
        })
      );
      return { target: 'container', amount };
    }

    window.scrollBy({ top: amount, behavior: 'instant' });
    return { target: 'window', amount };
  }, { ratio });
}

function shouldEscalateToSafeMode(report, limit) {
  if (limit > 0 && report.totalVideos >= limit) {
    return false;
  }
  if (report.totalVideos === 0) {
    return true;
  }
  if (report.stopReason === 'page-closed' || report.stopReason === 'scroll-error') {
    return true;
  }
  if (report.totalVideos < 8 && report.stopReason === 'idle-threshold') {
    return true;
  }
  return false;
}

function findFirstSecUserId(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value.startsWith('MS4wLjAB') ? value : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findFirstSecUserId(item);
      if (found) {
        return found;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    if (typeof value.sec_user_id === 'string' && value.sec_user_id.startsWith('MS4wLjAB')) {
      return value.sec_user_id;
    }
    if (typeof value.sec_uid === 'string' && value.sec_uid.startsWith('MS4wLjAB')) {
      return value.sec_uid;
    }
    for (const nested of Object.values(value)) {
      const found = findFirstSecUserId(nested);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

async function resolveProfileUrlFromSearchApi(page, douyinId, timeoutMs = 15000) {
  return Promise.race([
    page.evaluate(async ({ douyinId, timeoutMs }) => {
      const url =
        `/aweme/v1/web/general/search/single/?keyword=${encodeURIComponent(douyinId)}` +
        '&search_channel=user&offset=0&count=10&aid=6383&device_platform=webapp&channel=channel_pc_web';

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          credentials: 'include',
          signal: controller.signal,
        });
        const payload = await response.json();
        return {
          status: response.status,
          payload,
        };
      } catch (error) {
        return {
          status: 0,
          payload: null,
          error: error?.name === 'AbortError'
            ? `search-api-timeout-${timeoutMs}ms`
            : String(error?.message || error),
        };
      } finally {
        clearTimeout(timeout);
      }
    }, { douyinId, timeoutMs }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`search-api-evaluate-timeout-${timeoutMs + 2000}ms`)), timeoutMs + 2000);
    }),
  ]);
}

async function fetchProfileAwemesViaApi(page, secUserId, timeoutMs = 20000) {
  if (!secUserId) {
    return { awemeItems: [], ids: new Set(), pages: 0 };
  }

  const payload = await Promise.race([
    page.evaluate(async ({ secUserId, timeoutMs }) => {
      let maxCursor = 0;
      let hasMore = true;
      let pages = 0;
      const awemeItems = [];
      const seen = new Set();

      while (hasMore && pages < 40) {
        const url =
          `/aweme/v1/web/aweme/post/?device_platform=webapp&aid=6383&channel=channel_pc_web` +
          `&sec_user_id=${encodeURIComponent(secUserId)}&max_cursor=${maxCursor}&count=18&publish_video_strategy_type=2`;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        let data = null;
        try {
          const response = await fetch(url, {
            credentials: 'include',
            signal: controller.signal,
          });
          data = await response.json();
        } finally {
          clearTimeout(timeout);
        }

        const awemeList = Array.isArray(data?.aweme_list) ? data.aweme_list : [];

        for (const aweme of awemeList) {
          if (aweme?.aweme_id && !seen.has(aweme.aweme_id)) {
            seen.add(aweme.aweme_id);
            awemeItems.push(aweme);
          }
        }

        hasMore = Boolean(data?.has_more);
        maxCursor = data?.max_cursor ?? 0;
        pages += 1;
      }

      return { awemeItems, pages };
    }, { secUserId, timeoutMs }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`profile-api-sweep-timeout-${timeoutMs + 5000}ms`)), timeoutMs + 5000);
    }),
  ]);

  const ids = new Set();
  for (const aweme of payload.awemeItems) {
    if (aweme?.aweme_id) {
      ids.add(aweme.aweme_id);
    }
  }

  return {
    awemeItems: payload.awemeItems,
    ids,
    pages: payload.pages,
  };
}

async function promptLoginForDedicatedProfile(page) {
  console.log('\n需要在专用 DouyinScraper profile 中登录一次抖音。');
  console.log('请在刚打开的浏览器窗口中完成登录，脚本会等待 60 秒后自动重试...');
  await page.waitForTimeout(60000);
}

async function collectAllVideos(page, options, mode, seedMap = new Map()) {
  emitProgress({ stage: 'collecting', label: mode === 'safe' ? '安全补抓作品' : '滚动收集作品', discovered: seedMap.size, expectedTotal: options.expectedTotal || null });
  const modeConfig = SCRAPE_MODES[mode] || SCRAPE_MODES.fast;
  const foundVideoMap = new Map(seedMap);
  const pageUrl = page.url();
  const targetSecUserId = pageUrl.match(/douyin\.com\/user\/([^?]+)/)?.[1] || null;
  const postCollector = attachAwemePostCollector(page, foundVideoMap, targetSecUserId);
  const apiBackedIds = new Set(seedMap.keys());
  const incrementalBaselineIds = options.incrementalBaselineIds instanceof Set
    ? options.incrementalBaselineIds
    : new Set();
  let incrementalNewTotal = [...foundVideoMap.keys()].filter((videoId) => !incrementalBaselineIds.has(videoId)).length;
  let incrementalStableRounds = 0;
  const report = {
    mode,
    rounds: 0,
    idleRounds: 0,
    totalVideos: foundVideoMap.size,
    stopReason: 'max-scrolls',
    lastGrowthRound: foundVideoMap.size > 0 ? 0 : -1,
    apiResponses: 0,
  };

  try {
    await ensureWorksTab(page);
    await randomDelay(1500, 2200);

    const initialCards = await collectVisibleVideoCards(page).catch(() => []);
    const allowInitialDomExpansion = postCollector.state.responseCount === 0;
    for (const card of initialCards) {
      if (allowInitialDomExpansion || foundVideoMap.has(card.videoId)) {
        mergeVideoSnapshot(foundVideoMap, card);
      }
    }
    report.totalVideos = foundVideoMap.size;

    for (let round = 0; round < modeConfig.maxScrolls; round++) {
      if (!(await safePageAlive(page))) {
        report.stopReason = 'page-closed';
        report.rounds = round;
        break;
      }

      await performIncrementalScroll(page, round, modeConfig);
      await randomDelay(modeConfig.waitMinMs, modeConfig.waitMaxMs);

      if (!(await safePageAlive(page))) {
        report.stopReason = 'page-closed';
        report.rounds = round + 1;
        break;
      }

      const cards = await collectVisibleVideoCards(page).catch(() => null);
      if (!cards) {
        report.stopReason = 'scroll-error';
        report.rounds = round + 1;
        break;
      }

      let newCount = postCollector.consumeNewVideos();
      report.apiResponses = postCollector.state.responseCount;
      const allowDomExpansion = report.apiResponses === 0;
      for (const apiVideoId of postCollector.state.apiVideoIds) {
        apiBackedIds.add(apiVideoId);
      }

      for (const card of cards) {
        if (!(allowDomExpansion || foundVideoMap.has(card.videoId))) {
          continue;
        }
        if (mergeVideoSnapshot(foundVideoMap, card)) {
          newCount++;
        }
      }

      report.rounds = round + 1;
      report.totalVideos = foundVideoMap.size;
      const incrementalProgress = evaluateIncrementalProgress(
        foundVideoMap.keys(),
        incrementalBaselineIds,
        incrementalNewTotal,
        incrementalStableRounds,
        report.rounds,
      );
      incrementalNewTotal = incrementalProgress.newTotal;
      incrementalStableRounds = incrementalProgress.stableRounds;
      report.incrementalNewTotal = incrementalProgress.newTotal;
      report.incrementalOverlap = incrementalProgress.overlap;

      if (newCount > 0) {
        report.idleRounds = 0;
        report.lastGrowthRound = round + 1;
      } else {
        report.idleRounds++;
      }

      const scrollMetrics = await getScrollMetrics(page).catch(() => null);
      const nearBottom = scrollMetrics
        ? scrollMetrics.top + scrollMetrics.height >= scrollMetrics.scrollHeight - Math.max(600, scrollMetrics.height * 0.35)
        : false;

      if (round % 5 === 0 || newCount > 0) {
        emitProgress({ stage: 'collecting', label: mode === 'safe' ? '安全补抓作品' : '滚动收集作品', round: round + 1, discovered: foundVideoMap.size, expectedTotal: options.expectedTotal || null, detail: `第 ${round + 1} 轮，新增 ${newCount} 条` });
        console.log(
          `  [${mode}] round ${round + 1}: total ${foundVideoMap.size}, new ${newCount}, idle ${report.idleRounds}, nearBottom=${nearBottom}, apiResponses=${report.apiResponses}`
        );
      }

      if (options.limit > 0 && foundVideoMap.size >= options.limit) {
        report.stopReason = 'limit-reached';
        break;
      }

      if (incrementalProgress.shouldStop) {
        report.stopReason = 'incremental-baseline-overlap';
        emitProgress({
          stage: 'incremental_boundary',
          label: '已进入历史作品区间',
          round: report.rounds,
          discovered: foundVideoMap.size,
          expectedTotal: options.expectedTotal || null,
          detail: `发现 ${incrementalProgress.newTotal} 条候选新增，连续命中 ${incrementalProgress.overlap} 条历史作品`,
        });
        break;
      }

      if (
        Number.isFinite(options.expectedTotal) &&
        options.expectedTotal > 0 &&
        foundVideoMap.size >= options.expectedTotal &&
        report.idleRounds >= 2
      ) {
        report.stopReason = 'expected-total-reached';
        break;
      }

      if (
        Number.isFinite(options.expectedTotal) &&
        options.expectedTotal >= 50 &&
        foundVideoMap.size >= Math.floor(options.expectedTotal * 0.97) &&
        report.idleRounds >= modeConfig.idleRounds
      ) {
        report.stopReason = 'near-expected-total-stalled';
        break;
      }

      if (postCollector.state.hasMore === false && report.idleRounds >= 2) {
        report.stopReason = 'api-exhausted';
        break;
      }

      if (report.idleRounds >= modeConfig.idleRounds && round + 1 >= modeConfig.minRoundsBeforeStop && nearBottom) {
        report.stopReason = 'idle-threshold';
        break;
      }
    }
  } finally {
    postCollector.dispose();
  }

  return { foundVideoMap, report, apiBackedIds };
}

function loadIncrementalBaseline(filePath) {
  if (!filePath) return { ids: new Set(), outputPath: null };
  const payload = loadJsonFile(filePath, null);
  if (!payload || !Array.isArray(payload.works)) {
    throw new Error(`增量基线不可读取: ${filePath}`);
  }
  const ids = new Set(payload.works
    .map((work) => String(work.videoId || work.awemeId || work.id || '').trim())
    .filter(Boolean));
  if (!ids.size) throw new Error(`增量基线没有有效作品 ID: ${filePath}`);
  return { ids, outputPath: filePath };
}

function evaluateIncrementalProgress(foundIds, baselineIds, previousNewTotal, previousStableRounds, round) {
  const ids = [...foundIds].map(String);
  if (!(baselineIds instanceof Set) || baselineIds.size === 0) {
    return { newTotal: ids.length, overlap: 0, stableRounds: 0, shouldStop: false };
  }
  const newTotal = ids.filter((videoId) => !baselineIds.has(videoId)).length;
  const overlap = ids.length - newTotal;
  const stableRounds = newTotal > previousNewTotal ? 0 : previousStableRounds + 1;
  const requiredOverlap = Math.min(12, baselineIds.size);
  const shouldStop = round >= 3 && overlap >= requiredOverlap && stableRounds >= 2;
  return { newTotal, overlap, stableRounds, shouldStop };
}

function findKnownProfileUrl(douyinId) {
  const accountDir = getAccountAnalysisDir(sanitizeAccountSlug(douyinId));
  if (!fs.existsSync(accountDir)) return null;

  const jsonFiles = fs.readdirSync(accountDir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .map((name) => {
      const filePath = path.join(accountDir, name);
      return { filePath, modifiedAt: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);

  for (const file of jsonFiles.slice(0, 20)) {
    const payload = loadJsonFile(file.filePath, null);
    const profileUrl = String(payload?.profileUrl || '');
    const match = profileUrl.match(/^https:\/\/www\.douyin\.com\/user\/[A-Za-z0-9_-]+/);
    if (match) return match[0];
  }

  return null;
}

// main
async function main() {
  const options = parseArgs();

  if (!options.douyinId) {
    console.log('用法: npm run crawl:profile -- <douyin_id_or_profile_url> [options]');
    console.log('');
    console.log('参数:');
    console.log('  <douyin_id_or_profile_url>  抖音号、用户标识，或主页链接');
    console.log('');
    console.log('选项:');
    console.log('  --limit=<N>           最多保留前 N 条作品 (默认: 0，不截断)');
    console.log('  --days=<N>            只保留最近 N 天内的作品');
    console.log('  --date=<YYYY-MM-DD>   只保留该日期及之后的作品');
    console.log('  --min-likes=<N>       只保留点赞数 >= N 的作品');
    console.log('  --sort-by=<field>     排序字段: date | likes | comments | collects | shares | interactions');
    console.log('  --sort-order=<order>  排序方向: asc | desc (默认: desc)');
    console.log('  --skip-existing       跳过已处理作品 (默认开启)');
    console.log('  --no-skip             不跳过已处理作品');
    console.log('  --include-images      包含图文/非标准视频作品 (默认开启)');
    console.log('  --videos-only         只保留视频');
    console.log('  --exclude-images      --videos-only 的别名');
    console.log('  --alt-profile         使用备用 Chrome profile');
    console.log('  --alt                 --alt-profile 的别名');
    console.log('  --temp-profile        使用临时 profile');
    console.log('  --profile=<path>      指定 Chrome profile 路径');
    console.log('  --dry                 预览模式');
    console.log('');
    console.log('示例:');
    console.log('  npm run crawl:profile -- jianghushuo --dry');
    console.log('  npm run crawl:profile -- jianghushuo --days=7 --min-likes=1000');
    console.log('  npm run crawl:profile -- jianghushuo --videos-only --sort-by=likes --limit=5');
    return;
  }

  if (options.incrementalBaselinePath) {
    const baseline = loadIncrementalBaseline(options.incrementalBaselinePath);
    options.incrementalBaselineIds = baseline.ids;
    console.log(`增量模式: 已加载 ${baseline.ids.size} 条历史作品 ID`);
  }

  if (false && !options.douyinId) {
    console.log('用法: npm run crawl:profile -- <douyin_id> [options]');
    console.log('');
    console.log('参数:');
    console.log('  <douyin_id>    抖音号/博主ID');
    console.log('');
    console.log('选项:');
    console.log('  --limit=<N>      只获取最近 N 条视频 (默认: 10)');
    console.log('  --days=<N>       只获取最近 N 天内的视频');
    console.log('  --date=<YYYY-MM-DD>  获取指定日期及之后的视频');
    console.log('  --min-likes=<N>  只获取点赞数 >= N 的视频');
    console.log('  --sort-by=<field>  排序字段: date | likes');
    console.log('  --sort-order=<order>  排序方向: asc | desc (默认: desc)');
    console.log('  --dry            预览模式');
    console.log('');
    console.log('示例:');
    console.log('  npm run crawl:profile -- MS4wLjABAAAAxxx --limit=20');
    console.log('  npm run crawl:profile -- 1234567890 --days=7');
    console.log('  npm run crawl:profile -- 1234567890 --sort-by=likes --sort-order=desc --limit=5');
    return;
  }

// 检测是否是主页链接
function isProfileUrl(input) {
  return input && (
    input.includes('douyin.com/user/') ||
    input.includes('v.douyin.com/') ||
    input.startsWith('http')
  );
}

// 从URL中提取douyin ID
function extractDouyinIdFromUrl(url) {
  const match = url.match(/douyin\.com\/user\/([^?]+)/);
  return match ? match[1] : null;
}

  console.log('===== 通过抖音号获取视频 =====');

  // 检测是否是主页URL
  let profileUrl = null;
  let targetSecUserId = null;
  if (isProfileUrl(options.douyinId)) {
    profileUrl = options.douyinId;
    // 清理URL中的多余参数
    if (profileUrl.includes('douyin.com/user/')) {
      const match = profileUrl.match(/(https?:\/\/www\.douyin\.com\/user\/[^?]+)/);
      if (match) profileUrl = match[1];
    }
    targetSecUserId = extractDouyinIdFromUrl(profileUrl);
    console.log(`主页链接: ${profileUrl}`);
  } else {
    console.log(`抖音号: ${options.douyinId}`);
    const knownProfileUrl = findKnownProfileUrl(options.douyinId);
    if (knownProfileUrl) {
      profileUrl = knownProfileUrl;
      targetSecUserId = extractDouyinIdFromUrl(profileUrl);
      console.log(`复用历史已验证主页链接: ${profileUrl}`);
      emitProgress({
        stage: 'resolving_profile',
        label: '复用已验证主页地址',
        detail: '跳过不稳定的搜索步骤',
      });
    }
  }
  console.log(`获取限制: ${options.days ? `最近 ${options.days} 天` : options.date ? `从 ${options.date} 开始` : `最近 ${options.limit} 条`}`);
  if (options.minLikes > 0) {
    console.log(`最低点赞: ${options.minLikes}+`);
  }
  if (options.sortBy) {
    const orderLabel = options.sortOrder === 'asc' ? '升序' : '降序';
    console.log(`排序: ${options.sortBy} (${orderLabel})`);
  }
  console.log('');

  // 计算起始日期
  let startDate = null;
  if (options.days) {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - options.days);
  } else if (options.date) {
    startDate = new Date(options.date);
  }
  if (startDate) {
    startDate.setHours(0, 0, 0, 0);
  }

  const processedState = loadProcessedState();

  emitProgress({ stage: 'starting_profile', label: '启动专用 Chrome Profile' });
  console.log('启动 Chrome 浏览器（反检测模式）...');
  const chromeProfile = options.profile || TEMP_CHROME_PROFILE;
  const profileConfig = resolveChromeProfile(chromeProfile);
  const profileLock = acquireProfileLock(profileConfig.profilePath);
  process.once('exit', () => profileLock.release());

  // 构建反检测参数
  const stealthArgs = buildChromeLaunchArgs(profileConfig.profileDirectory);

  // 如果安装了 stealth 插件，使用它
  let contextOptions;
  if (stealthPlugin) {
    contextOptions = {
      executablePath: findChromePath(),
      headless: false,
      args: stealthArgs,
      plugins: [stealthPlugin],
      ignoreDefaultArgs: ['--enable-automation']
    };
  } else {
    contextOptions = {
      executablePath: findChromePath(),
      headless: false,
      args: stealthArgs
    };
  }

  const context = await chromium.launchPersistentContext(profileConfig.userDataDir, contextOptions);

  // 隐藏自动化特征 - 额外层保护
  await context.addInitScript(() => {
    // 隐藏 navigator.webdriver
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,
      configurable: true
    });

    // 隐藏 Chrome 运行时
    if (window.chrome) {
      Object.defineProperty(window.chrome, 'runtime', {
        get: () => ({ connected: true, id: '' }),
        configurable: true
      });
    }

    // 修改 permissions.query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // 隐藏 plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
      configurable: true
    });

    // 隐藏 languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en'],
      configurable: true
    });

    // 禁用 HardwareConcurrency 检测
    Object.defineProperty(navigator, 'hardwareConcurrency', {
      get: () => 8,
      configurable: true
    });

    // 禁用 deviceMemory 检测
    if (navigator.deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,
        configurable: true
      });
    }

    // 移除 automation 相关的 iframe
    const removeAutomationIframe = () => {
      const iframe = document.querySelector('iframe[src*="google.com"]');
      if (iframe) iframe.remove();
    };
    setTimeout(removeAutomationIframe, 100);

    // 覆盖 toString 避免检测
    window.console.debug = () => {};
  });

  let page = context.pages()[0] || await context.newPage();

  // 设置视口（模拟真实设备）
  await page.setViewportSize({ width: 1920, height: 1080 });

  // 设置 User Agent（模拟真实浏览器）
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  });

  let preloadedVideoMap = null;
  let preNavigationCollector = null;

  try {
    // 第一步：打开抖音首页
    emitProgress({ stage: 'opening_douyin', label: '打开抖音并确认登录态' });
    console.log('\n打开抖音首页...');

    let gotoSuccess = false;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`导航尝试 ${attempt}/2...`);
        await page.goto('https://www.douyin.com', {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        gotoSuccess = true;
        break;
      } catch (e) {
        console.log(`导航失败: ${e.message}`);
        if (attempt < 2) {
          console.log('等待 3 秒后重试...');
          await page.waitForTimeout(3000);
        }
      }
    }

    if (!gotoSuccess) {
      console.log('无法打开抖音页面，尝试使用备用方法...');
      await page.goto('https://www.douyin.com', { timeout: 60000 });
    }

    // 等待页面基本渲染
    console.log('等待页面加载...');
    await page.waitForTimeout(3000);
    await randomDelay(2000, 3000);

    // 检查页面是否有效
    try {
      const pageTitle = await page.title();
      console.log(`页面标题: ${pageTitle}`);
    } catch (e) {
      console.log('警告: 无法获取页面标题');
    }

    // 检查是否需要登录
    let needsLogin = false;
    try {
      needsLogin = await page.evaluate(() => {
        return document.body.textContent.includes('登录') &&
               document.body.textContent.includes('登录/注册');
      });
    } catch (e) {
      console.log('警告: 无法检查登录状态:', e.message);
    }

    if (needsLogin) {
      console.log('⚠️ 检测到登录页面，请手动登录...');
      console.log('请在浏览器窗口中完成登录，然后按 Enter 继续...');
      // 等待 60 秒让用户登录
      await page.waitForTimeout(60000);
    }

    // 检查页面是否仍然活跃（未被关闭）
    let pageAlive = false;
    try {
      pageAlive = await safePageAlive(page);
    } catch (e) {
      console.log('检查页面活跃状态时出错:', e.message);
      pageAlive = false;
    }
    if (!pageAlive) {
      console.log('页面已关闭，正在重新加载...');
      try {
        await page.goto('https://www.douyin.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2000);
      } catch (reloadError) {
        console.log('重新加载失败:', reloadError.message);
        console.log('尝试恢复浏览器上下文...');
        // 跳过重新加载，直接尝试导航
      }
    }

    // 关闭可能出现的登录弹窗（使用 JavaScript 直接操作 DOM）
    console.log('检查并关闭登录弹窗...');
    try {
      const closeResult = await page.evaluate(() => {
        // 方法1: 查找并点击关闭按钮
        const closeSelectors = [
          '[class*="close"]',
          'button[class*="close"]',
          '[aria-label*="关闭"]',
          '[aria-label*="close"]',
          '[class*="login"] [class*="close"]'
        ];

        for (const selector of closeSelectors) {
          const btn = document.querySelector(selector);
          if (btn && btn.offsetParent !== null) { // 检查元素是否可见
            btn.click();
            return 'closed-via-close-button';
          }
        }

        // 方法2: 按 ESC 键
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return 'tried-esc-key';
      });

      console.log(`登录弹窗处理结果: ${closeResult}`);
    } catch (e) {
      console.log('关闭登录弹窗时出错（继续执行）:', e.message);
    }

    // 根据是否有主页URL决定导航方式
    preloadedVideoMap = new Map();
    preNavigationCollector = targetSecUserId
      ? attachAwemePostCollector(page, preloadedVideoMap, targetSecUserId)
      : null;

    if (!profileUrl && !options.disableSearchApi) {
      console.log('\n尝试通过搜索 API 直接解析博主主页...');
      let searchApiResult = null;
      try {
        searchApiResult = await resolveProfileUrlFromSearchApi(page, options.douyinId);
      } catch (error) {
        console.log(`搜索 API 请求失败: ${error.message}`);
      }
      if (searchApiResult?.error) {
        console.log(`搜索 API 返回异常: ${searchApiResult.error}`);
      }

      if (searchApiResult?.payload?.status_code === 2483) {
        await promptLoginForDedicatedProfile(page);
        try {
          searchApiResult = await resolveProfileUrlFromSearchApi(page, options.douyinId);
        } catch (error) {
          console.log(`登录后搜索 API 仍失败: ${error.message}`);
        }
        if (searchApiResult?.error) {
          console.log(`登录后搜索 API 返回异常: ${searchApiResult.error}`);
        }
      }

      if (searchApiResult?.payload?.status_code === 2483) {
        throw new Error('DouyinScraper profile is not logged in. Please log in once in the dedicated browser window and retry.');
      }

      const resolvedSecUserId = findFirstSecUserId(searchApiResult?.payload);
      if (resolvedSecUserId) {
        targetSecUserId = resolvedSecUserId;
        profileUrl = `https://www.douyin.com/user/${resolvedSecUserId}`;
        preloadedVideoMap = new Map();
        if (preNavigationCollector) {
          preNavigationCollector.dispose();
        }
        preNavigationCollector = attachAwemePostCollector(page, preloadedVideoMap, targetSecUserId);
        console.log(`搜索 API 已解析主页: ${profileUrl}`);
      } else if (searchApiResult?.payload?.status_code && searchApiResult.payload.status_code !== 0) {
        console.log(`搜索 API 未返回可用主页: status_code=${searchApiResult.payload.status_code}`);
      }
    }

    if (profileUrl) {
      // 直接访问博主主页，跳过搜索步骤
      console.log('\n直接访问博主主页...');
      try {
        // 先检查页面是否可用
        if (page && !page.isClosed()) {
          await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(3000);
        } else {
          console.log('页面上下文已关闭，无法导航');
        }
      } catch (navError) {
        console.log('导航到博主主页时出错:', navError.message);
        console.log('尝试使用新页面打开...');
        try {
          const newPage = await context.newPage();
          await newPage.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
          await newPage.waitForTimeout(3000);
          // 将新页面设置为当前页面
          if (preNavigationCollector) {
            preNavigationCollector.dispose();
          }
          page = newPage;
          preNavigationCollector = attachAwemePostCollector(page, preloadedVideoMap, targetSecUserId);
        } catch (newPageError) {
          console.log('创建新页面也失败:', newPageError.message);
        }
      }
    } else {
      // 通过搜索方式查找博主
      // 第二步：找到搜索框并输入搜索内容
      console.log(`搜索账号: ${options.douyinId}`);

      // 尝试多种方式找到搜索框
      let searchBox = null;
      const searchSelectors = [
        'input[type="search"]',
        'input[placeholder*="搜索"]',
        'input[placeholder*="搜索用户"]',
        '[class*="search-input"] input',
        '[class*="searchBox"] input',
        '[class*="search-box"] input',
        'header input',
        '.search-input'
      ];

      for (const selector of searchSelectors) {
        searchBox = await page.$(selector);
        if (searchBox) {
          console.log(`找到搜索框: ${selector}`);
          break;
        }
      }

      if (!searchBox) {
        // 如果找不到，尝试点击搜索图标展开搜索框
        const searchIconSelectors = [
          '[class*="search-icon"]',
          '[class*="searchIcon"]',
          '[class*="search-btn"]',
          '[class*="searchBtn"]',
          '[class*="search-button"]',
          '[class*="searchButton"]',
          'svg[class*="search"]',
          'i[class*="search"]'
        ];

        for (const selector of searchIconSelectors) {
          const icon = await page.$(selector);
          if (icon) {
            console.log(`点击搜索图标: ${selector}`);
            await icon.click();
            await randomDelay(1000, 2000);
            break;
          }
        }

        // 再次尝试找搜索框
        for (const selector of searchSelectors) {
          searchBox = await page.$(selector);
          if (searchBox) break;
        }
      }

      if (!searchBox) {
        throw new Error('无法找到搜索框，请手动操作');
      }

      // 输入搜索内容 - 添加页面存活检查
      if (!(await safePageAlive(page))) {
        console.log('警告: 页面在找到搜索框后已关闭，尝试重新导航...');
        await page.goto('https://www.douyin.com/search/' + encodeURIComponent(options.douyinId), {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await page.waitForTimeout(3000);
        // 重新获取搜索框
        for (const selector of searchSelectors) {
          searchBox = await page.$(selector);
          if (searchBox) break;
        }
        if (!searchBox) {
          throw new Error('重新导航后无法找到搜索框');
        }
      }

      try {
        await searchBox.click({ force: true, timeout: 2000 });
        await randomDelay(500, 1000);
      } catch (e) {
        console.log('点击搜索框失败:', e.message);
        // 尝试重新获取并聚焦，避免 captcha 容器拦截普通点击
        for (const selector of searchSelectors) {
          const sb = await page.$(selector);
          if (sb) {
            searchBox = sb;
            break;
          }
        }
        if (searchBox) {
          try {
            await searchBox.focus();
          } catch (focusError) {
            console.log('聚焦搜索框失败，尝试 DOM focus:', focusError.message);
            await page.evaluate((selectorList) => {
              for (const selector of selectorList) {
                const input = document.querySelector(selector);
                if (input) {
                  input.focus();
                  return true;
                }
              }
              return false;
            }, searchSelectors).catch(() => {});
          }
          await randomDelay(1000, 2000);
        }
      }

      // 再次检查页面状态
      if (!(await safePageAlive(page))) {
        console.log('警告: 页面在点击搜索框后已关闭');
        throw new Error('页面在操作过程中关闭');
      }

      try {
        await searchBox.fill('');
        await randomDelay(300, 500);
      } catch (e) {
        console.log('清空搜索框失败:', e.message);
      }

      try {
        await searchBox.type(options.douyinId, { delay: 100 });
        await randomDelay(500, 1000);
      } catch (e) {
        console.log('输入搜索内容失败:', e.message);
        // 尝试使用 keyboard.type
        try {
          await page.keyboard.type(options.douyinId, { delay: 100 });
          await randomDelay(500, 1000);
        } catch (kbError) {
          console.log('键盘输入也失败:', kbError.message);
          throw new Error('无法输入搜索内容');
        }
      }

      // 按回车搜索
      await page.keyboard.press('Enter');

      // 等待搜索结果导航完成
      console.log('\n等待搜索结果...');
      try {
        // 等待导航，最多等待10秒
        await page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log('等待搜索结果时出错:', e.message);
        // 尝试等待页面稳定
        await page.waitForTimeout(2000);
      }

      // 安全检查：确保页面仍然可用
      if (!(await safePageAlive(page))) {
        console.log('警告: 页面可能在搜索过程中关闭，尝试重新导航...');
        try {
          await page.goto('https://www.douyin.com/search/' + encodeURIComponent(options.douyinId), {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await page.waitForTimeout(3000);
        } catch (navError) {
          console.log('重新导航失败:', navError.message);
        }
      }

      await waitForVerificationChallenge(page);

      // 查找用户搜索结果标签（通常搜索后会有"用户"标签）
      const userTabSelectors = [
        '[class*="tab"]:has-text("用户")',
        '[class*="user-tab"]',
        '[class*="userTab"]',
        '[role="tab"]:has-text("用户")',
        'div:has-text("用户")'
      ];

      let userTabFound = false;
      for (const selector of userTabSelectors) {
        try {
          if (!(await safePageAlive(page))) break;
          const userTab = await page.$(selector);
          if (userTab) {
            console.log('找到"用户"标签，点击进入');
            try {
              await userTab.click({ timeout: 8000 });
            } catch (clickError) {
              if (!(await waitForVerificationChallenge(page))) throw clickError;
              await userTab.click({ timeout: 8000 });
            }
            await randomDelay(2000, 3000);
            userTabFound = true;
            break;
          }
        } catch (e) {
          console.log('查找用户标签时出错:', e.message);
        }
      }

      // 第四步：点击博主卡片进入主页
      console.log('\n查找博主卡片...');
      await waitForVerificationChallenge(page);

      // 等待并查找博主卡片
      try {
        if (await safePageAlive(page)) {
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        console.log('等待博主卡片时出错:', e.message);
      }

      const creatorCardSelectors = [
        '[class*="user-card"]',
        '[class*="userCard"]',
        '[class*="author-card"]',
        '[class*="authorCard"]',
        '[class*="search-user"]',
        '[class*="searchResult"] [class*="avatar"]',
        '[class*="result-user"]'
      ];

      let creatorLink = null;

      for (const selector of creatorCardSelectors) {
        if (!(await safePageAlive(page))) break;
        const cards = await page.$$(selector);
        if (cards.length > 0) {
          console.log(`找到 ${cards.length} 个用户卡片，尝试获取链接...`);
          // 尝试从卡片中找链接
          for (const card of cards) {
            const link = await card.$('a[href*="douyin.com/user"]');
            if (link) {
              creatorLink = link;
              break;
            }
            // 尝试点击整个卡片
            const href = await card.getAttribute('href');
            if (href && href.includes('/user/')) {
              creatorLink = card;
              break;
            }
          }
          if (creatorLink) break;
        }
      }

      // 如果上面没找到，尝试更通用的方式
      if (!creatorLink) {
        // 查看所有 /user/ 链接，但排除 self 链接
        const allLinks = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/user/"]');
          const results = [];

          for (const link of links) {
            const href = link.href;
            const text = link.textContent?.trim() || '';

            // 跳过 self 链接（自己的主页）
            if (href.includes('/user/self') || href.includes('from_nav=1')) {
              continue;
            }

            results.push({
              href: href,
              text: text.substring(0, 50),
              visible: link.offsetParent !== null
            });
          }

          return results;
        });

        console.log(`找到 ${allLinks.length} 个其他用户链接:`);
        for (const link of allLinks) {
          console.log(`  - ${link.text || '无标题'}: ${link.href}`);
        }

        // 优先使用第一个有效的用户链接
        if (allLinks.length > 0) {
          // 找第一个可见的链接
          const visibleLink = allLinks.find(l => l.visible) || allLinks[0];
          creatorLink = visibleLink.href;
          console.log(`\n选择博主链接: ${creatorLink}`);
        }
      }

      if (!creatorLink) {
        if (await hasVisibleVerificationChallenge(page)) {
          throw new Error('抖音安全验证尚未完成，请在浏览器中完成验证后重新抓取');
        }
        throw new Error('无法找到博主卡片，请手动操作或检查抖音号是否正确');
      }

      // 获取博主信息（在点击前）
      const creatorInfo = await page.evaluate(() => {
        // 尝试从搜索结果卡片中获取信息
        const searchResultCards = document.querySelectorAll('[class*="search-result"], [class*="searchResult"], [class*="user-item"]');
        for (const card of searchResultCards) {
          const link = card.querySelector('a[href*="/user/"]');
          const nameEl = card.querySelector('[class*="nickname"], [class*="user-name"], [class*="author-name"], [class*="title"]');
          const fansEl = card.querySelector('[class*="follower"], [class*="fans"]');
          if (link && nameEl) {
            return {
              name: nameEl.textContent?.trim() || '',
              fans: fansEl?.textContent?.trim() || ''
            };
          }
        }
        return { name: '', fans: '' };
      });

      console.log(`\n找到博主: ${creatorInfo.name || '未知'}`);
      if (creatorInfo.fans) console.log(`粉丝数: ${creatorInfo.fans}`);

      // 点击进入博主主页 - 直接导航到获取到的链接
      console.log(`\n进入博主主页: ${creatorLink}`);

      // 【修复】添加网络空闲等待，确保页面完全加载
      try {
        await page.goto(creatorLink, {
          waitUntil: 'networkidle',
          timeout: 60000
        });
      } catch (e) {
        // 如果 networkidle 超时，尝试 domcontentloaded
        console.log('networkidle 超时，尝试 domcontentloaded...');
        await page.goto(creatorLink, {
          waitUntil: 'domcontentloaded',
          timeout: 60000
        });
      }

      // 【修复】等待更长时间让页面稳定，并添加存活检查
      console.log('等待页面稳定...');
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(1000);
        const isAlive = await safePageAlive(page);
        if (isAlive) {
          console.log(`页面稳定 (检查 ${i + 1}/10)`);
        } else {
          console.log(`页面在检查 ${i + 1} 时已关闭`);
          throw new Error('页面在加载过程中关闭');
        }
      }

      // 验证是否在正确的页面
      const currentUrl = page.url();
      console.log(`当前页面: ${currentUrl}`);
    }

    // 获取博主信息
    let finalCreatorInfo = { name: '未知', fans: '未知' };
    try {
      // 【修复】先确认页面存活再执行 evaluate
      if (await safePageAlive(page)) {
        finalCreatorInfo = await page.evaluate(() => {
          const nameEl = document.querySelector('[class*="nickname"], [class*="name"], h1, [class*="author-title"]');
          const fansEl = document.querySelector('[class*="follower"], [class*="fans"], [class*="count"]');
          return {
            name: nameEl?.textContent?.trim() || '',
            fans: fansEl?.textContent?.trim() || ''
          };
        });
      }
    } catch (e) {
      console.log(`获取博主信息失败: ${e.message}`);
      // 尝试从 URL 中提取博主 ID 作为后备
      const urlMatch = page.url().match(/\/user\/([^?]+)/);
      if (urlMatch) {
        console.log(`博主ID: ${urlMatch[1]}`);
      }
    }

    console.log(`\n博主主页信息:`);
    console.log(`  昵称: ${finalCreatorInfo.name || '未知'}`);
    console.log(`  粉丝: ${finalCreatorInfo.fans || '未知'}`);

    // 滚动加载更多视频 - 模拟真实用户行为
    console.log('\n滚动加载视频列表（模拟真实用户）...');
    let videos;
    let canonicalProfileApiIds = null;
    await page.waitForTimeout(3000);

    const pageHydration = await hydrateVideosFromPageData(page, preloadedVideoMap, targetSecUserId).catch((error) => {
      console.log(`首屏预加载数据解析失败: ${error.message}`);
      return { workCount: null, hydratedCount: 0 };
    });

    if (Number.isFinite(pageHydration.workCount) && pageHydration.workCount > 0) {
      console.log(`  页面作品总数: ${pageHydration.workCount}`);
      options.expectedTotal = pageHydration.workCount;
      emitProgress({ stage: 'profile_recognized', label: '识别主页作品总数', expectedTotal: pageHydration.workCount, discovered: preloadedVideoMap.size, detail: `主页显示 ${pageHydration.workCount} 条作品` });
    }
    if (pageHydration.hydratedCount > 0 || preloadedVideoMap.size > 0) {
      console.log(`  首屏预加载命中: ${pageHydration.hydratedCount}，预导航捕获: ${preloadedVideoMap.size}`);
    }

    if (options.useDirectApi) console.log('  尝试直连主页 API 分页补充...');
    const directProfileApi = options.useDirectApi
      ? await fetchProfileAwemesViaApi(page, targetSecUserId).catch((error) => {
        console.log(`  Direct profile API sweep failed: ${error.message}`);
        return { awemeItems: [], ids: new Set(), pages: 0 };
      })
      : { awemeItems: [], ids: new Set(), pages: 0 };
    if (directProfileApi.ids.size > 0) {
      canonicalProfileApiIds = directProfileApi.ids;
      for (const aweme of directProfileApi.awemeItems) {
        const video = createVideoSnapshotFromAweme(aweme, 'internal_api_supplement');
        if (video) {
          mergeVideoSnapshot(preloadedVideoMap, video);
        }
      }
      console.log(`  Direct profile API sweep: ${directProfileApi.ids.size} works across ${directProfileApi.pages} pages`);
      emitProgress({ stage: 'profile_api_complete', label: '主页分页抓取完成', pages: directProfileApi.pages, discovered: directProfileApi.ids.size, expectedTotal: options.expectedTotal || null, detail: `${directProfileApi.pages} 页，发现 ${directProfileApi.ids.size} 条` });
    }

    let captureResult;
    if (options.apiSupplementOnly) {
      captureResult = {
        foundVideoMap: preloadedVideoMap,
        apiBackedIds: directProfileApi.ids,
        report: {
          mode: 'api-supplement',
          rounds: directProfileApi.pages,
          totalVideos: preloadedVideoMap.size,
          stopReason: directProfileApi.ids.size ? 'api-exhausted' : 'api-empty',
        },
      };
    } else {
      const fastPass = await collectAllVideos(page, options, 'fast', preloadedVideoMap);
      captureResult = fastPass;
      console.log(
        `  [fast] stop=${fastPass.report.stopReason}, rounds=${fastPass.report.rounds}, total=${fastPass.report.totalVideos}`
      );

      if (shouldEscalateToSafeMode(fastPass.report, options.limit)) {
        console.log('  [safe] fast pass confidence is low, continuing with safe pass...');
        captureResult = await collectAllVideos(page, options, 'safe', fastPass.foundVideoMap);
        console.log(
          `  [safe] stop=${captureResult.report.stopReason}, rounds=${captureResult.report.rounds}, total=${captureResult.report.totalVideos}`
        );
      }
    }
    preNavigationCollector.dispose();

    console.log(
      `\nCapture summary: mode=${captureResult.report.mode}, rounds=${captureResult.report.rounds}, total=${captureResult.foundVideoMap.size}, stop=${captureResult.report.stopReason}`
    );
    console.log('\nBuilding video list...');

    videos = Array.from(captureResult.foundVideoMap.values()).map((video) => ({
      videoId: video.videoId,
      videoUrl: video.videoUrl || `https://www.douyin.com/video/${video.videoId}`,
      shareUrl: video.shareUrl || `https://v.douyin.com/${video.videoId}/`,
      title: video.title || '',
      desc: video.desc || video.title || '',
      date: video.date || '',
      likes: video.likes || 0,
      commentCount: video.commentCount || 0,
      collectCount: video.collectCount || 0,
      shareCount: video.shareCount || 0,
      playCount: video.playCount || 0,
      awemeType: video.awemeType || 0,
      durationMs: video.durationMs || 0,
      hasImages: Boolean(video.hasImages),
      contentType: video.contentType || 'video',
      publishTimestamp: video.publishTimestamp || null,
      authorNickname: video.authorNickname || '',
      authorSecUserId: video.authorSecUserId || '',
      authorUid: video.authorUid || '',
      authorAvatarUrl: video.authorAvatarUrl || '',
      hashtags: Array.isArray(video.hashtags) ? video.hashtags : [],
      mentions: Array.isArray(video.mentions) ? video.mentions : [],
      interactionTotal: video.interactionTotal || 0,
      acquisitionSources: [...new Set(video.acquisitionSources || [])],
    }));

    if (
      Number.isFinite(pageHydration.workCount) &&
      pageHydration.workCount > 0 &&
      canonicalProfileApiIds &&
      canonicalProfileApiIds.size === pageHydration.workCount &&
      videos.length !== pageHydration.workCount
    ) {
      const canonicalVideos = videos.filter((video) => canonicalProfileApiIds.has(video.videoId));
      if (canonicalVideos.length === pageHydration.workCount) {
        console.log(`Using direct profile API set as canonical source (${canonicalVideos.length} works)`);
        videos = canonicalVideos;
      }
    }

    if (
      Number.isFinite(pageHydration.workCount) &&
      pageHydration.workCount > 0 &&
      captureResult.apiBackedIds &&
      captureResult.apiBackedIds.size > 0 &&
      videos.length > pageHydration.workCount
    ) {
      const apiBackedVideos = videos.filter((video) => captureResult.apiBackedIds.has(video.videoId));
      if (apiBackedVideos.length >= pageHydration.workCount && apiBackedVideos.length < videos.length) {
        console.log(`Trimming ${videos.length - apiBackedVideos.length} DOM-only works that were not confirmed by profile API`);
        videos = apiBackedVideos;
      }
    }

    if (targetSecUserId) {
      const foreignAuthorWorks = videos.filter((video) => video.authorSecUserId && video.authorSecUserId !== targetSecUserId);
      if (foreignAuthorWorks.length) {
        console.log(`Filtering ${foreignAuthorWorks.length} works whose author does not match the profile owner`);
        videos = videos.filter((video) => !video.authorSecUserId || video.authorSecUserId === targetSecUserId);
        emitProgress({
          stage: 'reconciling',
          label: '排除非本博主作品',
          discovered: videos.length,
          expectedTotal: options.expectedTotal || null,
          detail: `已排除 ${foreignAuthorWorks.length} 条异作者作品`,
        });
      }
    }

    const imagePosts = videos.filter((video) => video.contentType === 'image');
    const playableVideos = videos.filter((video) => video.contentType !== 'image');
    const oldestVisibleDate = videos
      .map((video) => video.date)
      .filter(Boolean)
      .sort()[0];

    console.log(`Collected ${videos.length} works`);
    emitProgress({ stage: 'reconciling', label: '作品去重与数量对账', discovered: videos.length, expectedTotal: options.expectedTotal || null, detail: `已去重 ${videos.length} 条` });
    console.log(`Accessible videos: ${playableVideos.length}, image posts: ${imagePosts.length}`);
    if (Number.isFinite(pageHydration.workCount) && pageHydration.workCount > 0) {
      const missingCount = pageHydration.workCount - videos.length;
      console.log(`Page total check: ${videos.length}/${pageHydration.workCount}`);
      if (missingCount > 0) {
        console.log(`Still missing about ${missingCount} videos compared with page total`);
      }
    }
    if (oldestVisibleDate) {
      console.log(`Oldest accessible work date: ${oldestVisibleDate}`);
    }

    if (videos.length === 0) {
      console.log('\n未找到视频，可能需要调整页面选择器');
      console.log('请确认抖音号是否正确');
      return;
    }

    // 过滤和排序
    let filteredVideos = options.includeImages ? videos : playableVideos;

    if (!options.includeImages && imagePosts.length > 0) {
      console.log(`当前仅保留视频，已排除 ${imagePosts.length} 条图文/非标准视频作品；如需包含，使用默认模式或显式加 --include-images`);
    } else if (options.includeImages && imagePosts.length > 0) {
      console.log(`当前已包含 ${imagePosts.length} 条图文/非标准视频作品；如只要视频，使用 --videos-only`);
    }

    // 按日期过滤
    if (startDate) {
      filteredVideos = filteredVideos.filter(v => {
        if (!v.date) return true;
        const dateMatch = v.date.match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/);
        if (dateMatch) {
          const publishDate = new Date(dateMatch[1], dateMatch[2] - 1, dateMatch[3]);
          return publishDate >= startDate;
        }
        // 尝试解析ISO格式
        const isoDate = new Date(v.date);
        if (!isNaN(isoDate.getTime())) {
          return isoDate >= startDate;
        }
        return true;
      });
      console.log(`日期过滤后: ${filteredVideos.length} 个视频`);
    }

    // 按点赞数过滤
    if (options.minLikes > 0) {
      const beforeCount = filteredVideos.length;
      filteredVideos = filteredVideos.filter(v => v.likes >= options.minLikes);
      console.log(`点赞数 >= ${options.minLikes} 过滤后: ${filteredVideos.length} 个视频 (移除了 ${beforeCount - filteredVideos.length} 个)`);
    }

    // 排序
    if (options.sortBy) {
      filteredVideos.sort((a, b) => {
        let aVal, bVal;

        if (options.sortBy === 'date') {
          // 优先使用实际日期，没有则尝试解析相对日期
          aVal = a.date || '';
          bVal = b.date || '';

          // 如果没有日期，设为极小值排到最后
          if (!aVal) return 1;
          if (!bVal) return -1;

          // 解析日期用于比较
          const aMatch = aVal.match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/);
          const bMatch = bVal.match(/(\d{4})[年\-\/](\d{1,2})[月\-\/](\d{1,2})/);

          if (aMatch && bMatch) {
            aVal = new Date(aMatch[1], aMatch[2] - 1, aMatch[3]).getTime();
            bVal = new Date(bMatch[1], bMatch[2] - 1, bMatch[3]).getTime();
          } else {
            // 尝试ISO格式
            aVal = new Date(aVal).getTime() || 0;
            bVal = new Date(bVal).getTime() || 0;
          }
        } else if (options.sortBy === 'likes') {
          aVal = a.likes || 0;
          bVal = b.likes || 0;
        } else if (options.sortBy === 'comments') {
          aVal = a.commentCount || 0;
          bVal = b.commentCount || 0;
        } else if (options.sortBy === 'collects') {
          aVal = a.collectCount || 0;
          bVal = b.collectCount || 0;
        } else if (options.sortBy === 'shares') {
          aVal = a.shareCount || 0;
          bVal = b.shareCount || 0;
        } else if (options.sortBy === 'interactions') {
          aVal = a.interactionTotal || 0;
          bVal = b.interactionTotal || 0;
        }

        // 根据排序方向返回
        if (options.sortOrder === 'asc') {
          return aVal - bVal;
        } else {
          return bVal - aVal;
        }
      });

      const orderLabel = options.sortOrder === 'asc' ? '升序' : '降序';
      console.log(`排序 (${options.sortBy} ${orderLabel}): ${filteredVideos.length} 个视频`);
    }

    // 限制数量（取最新的）
    if (options.limit && filteredVideos.length > options.limit) {
      filteredVideos = filteredVideos.slice(0, options.limit);
    }

    // 显示视频列表（完整信息：序号、标题、分享链接、点赞数）
    console.log('\n视频列表:');
    filteredVideos.forEach((v, i) => {
      const processed = processedState.processedVideoIds.has(v.videoId);
      const titleDisplay = v.title ? v.title : '[无标题]';
      const likesDisplay = v.likes > 0 ? `点赞: ${v.likes.toLocaleString()}` : '';
      const commentsDisplay = v.commentCount > 0 ? `评论: ${v.commentCount.toLocaleString()}` : '';
      const collectsDisplay = v.collectCount > 0 ? `收藏: ${v.collectCount.toLocaleString()}` : '';
      const sharesDisplay = v.shareCount > 0 ? `分享: ${v.shareCount.toLocaleString()}` : '';
      const processedMark = processed ? ' ✓ 已处理' : '';

      console.log(`  ${i + 1}. ${titleDisplay}${processedMark}`);
      console.log(`     分享链接: ${v.shareUrl}`);
      if (likesDisplay) console.log(`     ${likesDisplay}`);
      if (commentsDisplay || collectsDisplay || sharesDisplay) {
        console.log(`     ${[commentsDisplay, collectsDisplay, sharesDisplay].filter(Boolean).join(' | ')}`);
      }
    });

    emitProgress({ stage: 'exporting_json', label: '导出并审核 JSON', discovered: filteredVideos.length, expectedTotal: options.expectedTotal || null });
    const analysisFile = exportAnalysisBundle(
      options.douyinId,
      profileUrl,
      videos,
      filteredVideos,
      options,
      pageHydration.workCount
    );
    console.log(`\n自媒体分析数据已导出: ${analysisFile}`);
    emitProgress({ stage: 'json_exported', label: 'JSON 已导出，等待本地审核', outputPath: analysisFile, discovered: filteredVideos.length, expectedTotal: options.expectedTotal || null });

    if (options.dry) {
      await context.close();
      console.log('\n预览模式：退出');
      return;
    }

    await context.close();
    console.log('\n抓取阶段完成。');
    console.log(`已导出分析底座，共 ${filteredVideos.length} 条作品。`);
    console.log('下一步请基于该 JSON 运行第二阶段脚本:');
    console.log('  node scripts/fetch-getnotes-from-analysis.js --latest');

  } catch (e) {
    console.error('错误:', e.message);
    emitProgress({ stage: 'failed', label: '抓取失败', detail: e.message });
    process.exitCode = 1;
  } finally {
    if (preNavigationCollector) {
      preNavigationCollector.dispose();
    }
    if (!context.isClosed()) {
      await context.close().catch(() => {});
    }
    profileLock.release();
  }
}

// 运行
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  main,
  createVideoSnapshotFromAweme,
  evaluateIncrementalProgress,
  findKnownProfileUrl,
  loadIncrementalBaseline,
};
