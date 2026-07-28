const fs = require("fs");
const path = require("path");
const { CONFIG_PATH, loadTranscriptionConfig } = require("../config/transcription-config");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CLOUD_CONFIG_PATH = path.join(PROJECT_ROOT, "config", "text-extraction.config.json");
const CLOUD_EXAMPLE_PATH = path.join(PROJECT_ROOT, "config", "text-extraction.config.example.json");

function readJson(filepath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function writeJson(filepath, value) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filepath);
}

function runtimeDiagnostics() {
  const files = {
    ffmpeg: path.join(PROJECT_ROOT, "runtime", "bin", "ffmpeg", "ffmpeg.exe"),
    model: path.join(PROJECT_ROOT, "runtime", "models", "faster-whisper-small", "model.bin"),
    python: path.join(PROJECT_ROOT, "runtime", "python", ".venv", "Scripts", "python.exe"),
  };
  return Object.fromEntries(Object.entries(files).map(([key, filepath]) => {
    const exists = fs.existsSync(filepath);
    return [key, { ready: exists, path: filepath, sizeBytes: exists ? fs.statSync(filepath).size : 0 }];
  }));
}

function getSettings() {
  const transcription = loadTranscriptionConfig();
  const cloud = readJson(CLOUD_CONFIG_PATH, readJson(CLOUD_EXAMPLE_PATH));
  return {
    selectionMode: transcription.selectionMode,
    defaultProvider: transcription.defaultProvider,
    cloudDailyReferenceLimit: transcription.cloudDailyReferenceLimit,
    whisper: transcription.whisper,
    cloud: {
      apiBaseUrl: cloud.apiBaseUrl || "",
      clientId: cloud.clientId || "",
      apiKeyConfigured: Boolean(cloud.apiKey && !String(cloud.apiKey).startsWith("replace-")),
    },
    diagnostics: runtimeDiagnostics(),
  };
}

function saveSettings(input) {
  const current = getSettings();
  const defaultProvider = ["getnotes", "whisper"].includes(input.defaultProvider) ? input.defaultProvider : current.defaultProvider;
  const transcription = {
    selectionMode: "manual",
    defaultProvider,
    cloudDailyReferenceLimit: 100,
    whisper: {
      ...current.whisper,
      device: input.whisper?.device === "cuda" ? "cuda" : "cpu",
      computeType: String(input.whisper?.computeType || current.whisper.computeType || "int8"),
      language: String(input.whisper?.language || current.whisper.language || "zh"),
      retainDownloadedMedia: Boolean(input.whisper?.retainDownloadedMedia),
    },
  };
  writeJson(CONFIG_PATH, transcription);

  const oldCloud = readJson(CLOUD_CONFIG_PATH, readJson(CLOUD_EXAMPLE_PATH));
  const apiBaseUrl = String(input.cloud?.apiBaseUrl || oldCloud.apiBaseUrl || "").trim();
  const clientId = String(input.cloud?.clientId || oldCloud.clientId || "").trim();
  const apiKey = String(input.cloud?.apiKey || "").trim() || oldCloud.apiKey || "";
  if (!apiBaseUrl || !clientId || !apiKey) throw new Error("云端链接提取需要填写服务地址、Client ID 和 API Key。");
  writeJson(CLOUD_CONFIG_PATH, { apiBaseUrl, apiKey, clientId });
  return getSettings();
}

module.exports = { getSettings, saveSettings };
