const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.resolve(__dirname, "../../config/transcription.config.json");
const EXAMPLE_PATH = path.resolve(__dirname, "../../config/transcription.config.example.json");

const DEFAULTS = {
  selectionMode: "manual",
  defaultProvider: "cloud-first",
  cloudDailyReferenceLimit: 100,
  whisper: {
    model: "small",
    device: "cpu",
    computeType: "int8",
    language: "zh",
    retainDownloadedMedia: false,
  },
};

function readJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, ""));
}

function loadTranscriptionConfig() {
  const source = fs.existsSync(CONFIG_PATH) ? readJson(CONFIG_PATH) : (fs.existsSync(EXAMPLE_PATH) ? readJson(EXAMPLE_PATH) : {});
  const defaultProvider = source.defaultProvider === "getnotes"
    ? "cloud-first"
    : source.defaultProvider === "whisper"
      ? "whisper-first"
      : source.defaultProvider;
  return {
    ...DEFAULTS,
    ...source,
    defaultProvider: ["cloud-first", "whisper-first"].includes(defaultProvider) ? defaultProvider : DEFAULTS.defaultProvider,
    whisper: { ...DEFAULTS.whisper, ...(source.whisper || {}) },
  };
}

module.exports = { CONFIG_PATH, loadTranscriptionConfig };
