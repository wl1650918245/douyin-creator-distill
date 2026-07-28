const fs = require("fs");
const path = require("path");
const {
  DEFAULT_CHROME_USER_DATA_DIR,
  RUNTIME_DIR,
  TEMP_CHROME_PROFILE,
  ensureDir,
} = require("./runtime-config");

const CONFIG_PATH = path.resolve(
  process.env.ACCOUNT_PROFILES_CONFIG_PATH
    || path.join(__dirname, "../../config/account-profiles.config.json")
);
const STATUS_DIR = path.join(RUNTIME_DIR, "account-status");
const LEGACY_STATUS_PATH = path.join(RUNTIME_DIR, "douyin-profile-status.json");
const ROLE_LABELS = { content: "内容采集账号", favorites: "收藏夹账号" };
const DEFAULTS = {
  schemaVersion: "1.0",
  favoritesBinding: "shared",
  profiles: {
    content: {
      id: "content-collector",
      profilePath: TEMP_CHROME_PROFILE,
    },
    favorites: {
      id: "favorites-owner",
      profilePath: process.env.DOUYIN_FAVORITES_CHROME_PROFILE
        || path.join(DEFAULT_CHROME_USER_DATA_DIR, "DouyinFavorites"),
    },
  },
};

function readJson(filepath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return fallback;
  }
}

function safeProfileId(value, fallback) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 40);
  return normalized || fallback;
}

function normalizeConfig(raw = {}) {
  const favoritesBinding = raw.favoritesBinding === "independent" ? "independent" : "shared";
  const content = raw.profiles?.content || {};
  const favorites = raw.profiles?.favorites || {};
  return {
    schemaVersion: "1.0",
    favoritesBinding,
    profiles: {
      content: {
        id: safeProfileId(content.id, DEFAULTS.profiles.content.id),
        profilePath: path.resolve(content.profilePath || DEFAULTS.profiles.content.profilePath),
      },
      favorites: {
        id: safeProfileId(favorites.id, DEFAULTS.profiles.favorites.id),
        profilePath: path.resolve(favorites.profilePath || DEFAULTS.profiles.favorites.profilePath),
      },
    },
  };
}

function loadAccountProfiles() {
  return normalizeConfig(readJson(CONFIG_PATH, DEFAULTS));
}

function writeAccountProfiles(config) {
  ensureDir(path.dirname(CONFIG_PATH));
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
  return config;
}

function saveAccountProfiles(input = {}) {
  if (!["shared", "independent"].includes(input.favoritesBinding)) {
    throw new Error("收藏夹账号绑定方式只支持 shared 或 independent");
  }
  const current = loadAccountProfiles();
  return writeAccountProfiles(normalizeConfig({
    ...current,
    favoritesBinding: input.favoritesBinding,
  }));
}

function resolveAccountRole(role) {
  if (!Object.hasOwn(ROLE_LABELS, role)) throw new Error("账号用途只支持 content 或 favorites");
  const config = loadAccountProfiles();
  const shared = role === "favorites" && config.favoritesBinding === "shared";
  const effectiveRole = shared ? "content" : role;
  const profile = config.profiles[effectiveRole];
  return {
    role,
    roleLabel: ROLE_LABELS[role],
    effectiveRole,
    profileId: profile.id,
    profilePath: profile.profilePath,
    shared,
  };
}

function statusPath(profileId) {
  return path.join(STATUS_DIR, `${safeProfileId(profileId, "unknown")}.json`);
}

function readRoleStatus(role) {
  const profile = resolveAccountRole(role);
  const filepath = statusPath(profile.profileId);
  const status = readJson(filepath, role === "content" ? readJson(LEGACY_STATUS_PATH, {}) : {});
  return {
    ready: status?.ready === true,
    phase: String(status?.phase || "not_verified"),
    updatedAt: status?.updatedAt || "",
    verifiedAt: status?.verifiedAt || "",
    error: status?.error ? String(status.error) : "",
  };
}

function writeRoleStatus(role, status) {
  const profile = resolveAccountRole(role);
  ensureDir(STATUS_DIR);
  const payload = {
    ...status,
    profileId: profile.profileId,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(statusPath(profile.profileId), JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function publicAccountProfiles() {
  const config = loadAccountProfiles();
  const roles = {};
  for (const role of Object.keys(ROLE_LABELS)) {
    const profile = resolveAccountRole(role);
    const status = readRoleStatus(role);
    roles[role] = {
      role,
      label: ROLE_LABELS[role],
      profileId: profile.profileId,
      effectiveProfileId: profile.profileId,
      shared: profile.shared,
      status: {
        ...status,
        error: status.error ? "登录检查失败，请重新打开登录窗口或查看本地日志。" : "",
      },
    };
  }
  return {
    schemaVersion: config.schemaVersion,
    favoritesBinding: config.favoritesBinding,
    favoritesCapability: "directory_discovery_and_selected_crawl_verified",
    roles,
  };
}

module.exports = {
  CONFIG_PATH,
  loadAccountProfiles,
  publicAccountProfiles,
  readRoleStatus,
  resolveAccountRole,
  saveAccountProfiles,
  statusPath,
  writeRoleStatus,
};
