const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const userHome = process.env.USERPROFILE || process.env.HOME || process.cwd();
const DEFAULT_ASSET_ROOT = path.join(userHome, "Documents", "DouyinKnowledgeAssets");
const KNOWLEDGE_ASSET_ROOT = path.resolve(process.env.KNOWLEDGE_ASSET_ROOT || DEFAULT_ASSET_ROOT);
const ANALYSIS_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "raw", "douyin-analysis");
const GETNOTES_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "raw", "get-notes");
const TRANSCRIPTS_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "raw", "transcripts");
const VIRAL_BREAKDOWN_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "analyses", "viral-breakdowns");
const TOPIC_LIBRARY_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "analyses", "topic-library");
const CREATOR_AGENTS_DIR = path.join(KNOWLEDGE_ASSET_ROOT, "agents");
const RUNTIME_DIR = path.join(KNOWLEDGE_ASSET_ROOT, ".runtime");
const PROFILE_LOCKS_DIR = path.join(RUNTIME_DIR, "profile-locks");
const PROCESSED_VIDEOS_STATE_FILE = path.join(RUNTIME_DIR, "processed-video-ids.json");
const activeProfileLocks = new Map();

const DEFAULT_CHROME_USER_DATA_DIR = path.join(
  process.env.LOCALAPPDATA || "",
  "Google",
  "Chrome",
  "User Data"
);
const DEFAULT_CHROME_PROFILE = path.join(DEFAULT_CHROME_USER_DATA_DIR, "Default");
const ALT_CHROME_PROFILE = path.join(DEFAULT_CHROME_USER_DATA_DIR, "Profile 2");
const TEMP_CHROME_PROFILE = process.env.DOUYIN_CHROME_PROFILE || path.join(DEFAULT_CHROME_USER_DATA_DIR, "DouyinScraper");

function ensureDir(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function loadJsonFile(filepath, fallback) {
  try {
    if (fs.existsSync(filepath)) {
      return JSON.parse(fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, ""));
    }
  } catch (error) {
    console.warn(`Failed to read ${filepath}: ${error.message}`);
  }
  return fallback;
}

function saveJsonFile(filepath, data) {
  ensureDir(path.dirname(filepath));
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), "utf8");
}

function sanitizeAccountSlug(value) {
  const slug = String(value || "unknown-account")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/\.+/g, ".")
    .slice(0, 80);
  return slug || "unknown-account";
}

function getAccountAnalysisDir(accountSlug) {
  return path.join(ANALYSIS_DIR, sanitizeAccountSlug(accountSlug));
}
function getAccountGetNotesDir(accountSlug) {
  return path.join(GETNOTES_DIR, sanitizeAccountSlug(accountSlug));
}
function getAccountTranscriptDir(accountSlug) {
  return path.join(TRANSCRIPTS_DIR, sanitizeAccountSlug(accountSlug));
}
function getAccountViralBreakdownDir(accountSlug) {
  return path.join(VIRAL_BREAKDOWN_DIR, sanitizeAccountSlug(accountSlug));
}
function getAccountTopicLibraryDir(accountSlug) {
  return path.join(TOPIC_LIBRARY_DIR, sanitizeAccountSlug(accountSlug));
}
function getAccountCreatorAgentDir(accountSlug) {
  return path.join(CREATOR_AGENTS_DIR, sanitizeAccountSlug(accountSlug));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireProfileLock(profilePath) {
  ensureDir(PROFILE_LOCKS_DIR);
  const resolvedProfilePath = path.resolve(profilePath);
  const fingerprint = crypto.createHash("sha1").update(resolvedProfilePath).digest("hex");
  const lockFile = path.join(PROFILE_LOCKS_DIR, `${fingerprint}.lock.json`);
  const lockId = crypto.randomUUID();
  const payload = { pid: process.pid, lockId, acquiredAt: new Date().toISOString(), profilePath: resolvedProfilePath };

  try {
    fs.writeFileSync(lockFile, JSON.stringify(payload, null, 2), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = loadJsonFile(lockFile, null);
    const activeLockId = activeProfileLocks.get(lockFile);
    const ownedByActiveOperation = existing?.pid === process.pid && activeLockId && existing.lockId === activeLockId;
    if (ownedByActiveOperation || (existing?.pid && existing.pid !== process.pid && isProcessAlive(existing.pid))) {
      const holder = existing?.pid ? `PID ${existing.pid}` : "another process";
      const busyError = new Error(`Chrome profile is already in use by ${holder}. Run Douyin crawl tasks serially for this profile.`);
      busyError.code = "PROFILE_LOCK_BUSY";
      throw busyError;
    }
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, JSON.stringify(payload, null, 2), { encoding: "utf8", flag: "wx" });
  }
  activeProfileLocks.set(lockFile, lockId);

  return {
    release() {
      const existing = loadJsonFile(lockFile, null);
      if (fs.existsSync(lockFile) && (!existing || (existing.pid === process.pid && existing.lockId === lockId))) {
        fs.unlinkSync(lockFile);
      }
      if (activeProfileLocks.get(lockFile) === lockId) activeProfileLocks.delete(lockFile);
    },
  };
}

async function acquireProfileLockWithRetry(profilePath, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 120000);
  const retryIntervalMs = Number(options.retryIntervalMs || 1000);
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      return acquireProfileLock(profilePath);
    } catch (error) {
      if (error.code !== "PROFILE_LOCK_BUSY" || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }
}

function resolveChromeProfile(profilePath) {
  const resolvedProfilePath = profilePath || TEMP_CHROME_PROFILE;
  const profileDirectory = path.basename(resolvedProfilePath);
  if (profileDirectory === "Default" || /^Profile \d+$/.test(profileDirectory)) {
    return { userDataDir: path.dirname(resolvedProfilePath), profileDirectory, profilePath: resolvedProfilePath };
  }
  return { userDataDir: resolvedProfilePath, profileDirectory: null, profilePath: resolvedProfilePath };
}

function buildChromeLaunchArgs(profileDirectory) {
  const args = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1920,1080",
    "--start-maximized",
  ];
  if (profileDirectory) args.unshift(`--profile-directory=${profileDirectory}`);
  return args;
}

function findChromePath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.ProgramFiles || "", "Google", "Chrome", "Application", "chrome.exe"),
    "/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];
  const chromePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!chromePath) throw new Error("Chrome browser was not found");
  return chromePath;
}

module.exports = {
  ALT_CHROME_PROFILE,
  ANALYSIS_DIR,
  CREATOR_AGENTS_DIR,
  DEFAULT_CHROME_USER_DATA_DIR,
  GETNOTES_DIR,
  TRANSCRIPTS_DIR,
  TOPIC_LIBRARY_DIR,
  VIRAL_BREAKDOWN_DIR,
  DEFAULT_CHROME_PROFILE,
  KNOWLEDGE_ASSET_ROOT,
  PROCESSED_VIDEOS_STATE_FILE,
  RUNTIME_DIR,
  TEMP_CHROME_PROFILE,
  acquireProfileLock,
  acquireProfileLockWithRetry,
  buildChromeLaunchArgs,
  ensureDir,
  findChromePath,
  getAccountAnalysisDir,
  getAccountGetNotesDir,
  getAccountCreatorAgentDir,
  getAccountTopicLibraryDir,
  getAccountTranscriptDir,
  getAccountViralBreakdownDir,
  loadJsonFile,
  resolveChromeProfile,
  sanitizeAccountSlug,
  saveJsonFile,
};
