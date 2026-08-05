const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const CONFIG_PATH = path.resolve(process.env.SEMANTIC_SEARCH_CONFIG_PATH || path.join(PROJECT_ROOT, "config", "semantic-search.config.json"));
const CONFIG_EXAMPLE_PATH = path.join(PROJECT_ROOT, "config", "semantic-search.config.example.json");
const MODEL_ROOT = path.resolve(process.env.EMBEDDING_MODELS_DIR || path.join(PROJECT_ROOT, "runtime", "models", "embedding"));
const PYTHON_PATH = path.resolve(process.env.EMBEDDING_PYTHON_PATH || path.join(PROJECT_ROOT, "runtime", "python", ".venv", "Scripts", "python.exe"));
const DOWNLOAD_SCRIPT = path.join(PROJECT_ROOT, "scripts", "manage_embedding_model.py");
const ANALYSIS_MODEL_CONFIG_PATH = path.resolve(process.env.ANALYSIS_MODEL_CONFIG_PATH || path.join(PROJECT_ROOT, "config", "model.config.json"));

const MODELS = Object.freeze({
  lightweight: Object.freeze({
    id: "lightweight",
    label: "轻量模式",
    repoId: "BAAI/bge-small-zh-v1.5",
    modelScopeId: "AI-ModelScope/bge-small-zh-v1.5",
    approximateBytes: 96 * 1024 * 1024,
    approximateSize: "约 96 MB",
    dimension: 512,
    license: "MIT",
    summary: "适合标题、简介和分段正文的日常语义筛选。",
  }),
  high_precision: Object.freeze({
    id: "high_precision",
    label: "高精度模式",
    repoId: "Qwen/Qwen3-Embedding-0.6B",
    modelScopeId: "Qwen/Qwen3-Embedding-0.6B",
    approximateBytes: Math.round(1.2 * 1024 * 1024 * 1024),
    approximateSize: "约 1.2 GB",
    dimension: 1024,
    license: "Apache-2.0",
    summary: "适合复杂语义、长文本和更精细的知识召回。",
  }),
});

const operations = new Map();
let cachedRuntimeState;

function readJson(filepath, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(filepath, "utf8").replace(/^\uFEFF/, "")); } catch { return fallback; }
}

function writeJson(filepath, value) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  const temporary = `${filepath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(temporary, filepath);
}

function modelDefinition(modelId) {
  const model = MODELS[modelId];
  if (!model) throw new Error("未知的智能筛选模型。");
  return model;
}

function modelDirectory(modelId) {
  modelDefinition(modelId);
  const directory = path.resolve(MODEL_ROOT, modelId);
  if (directory !== MODEL_ROOT && !directory.startsWith(`${MODEL_ROOT}${path.sep}`)) throw new Error("模型目录越界。");
  return directory;
}

function directorySize(directory) {
  if (!fs.existsSync(directory)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filepath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directorySize(filepath);
    else if (entry.isFile()) total += fs.statSync(filepath).size;
  }
  return total;
}

function hasModelWeights(directory) {
  if (!fs.existsSync(directory)) return false;
  return fs.readdirSync(directory, { recursive: true, withFileTypes: true })
    .some((entry) => entry.isFile() && /(?:model(?:-\d+-of-\d+)?\.safetensors|pytorch_model(?:-\d+-of-\d+)?\.bin)$/i.test(entry.name));
}

function installationState(modelId) {
  const model = modelDefinition(modelId);
  const directory = modelDirectory(modelId);
  const marker = path.join(directory, ".download-complete.json");
  const installed = fs.existsSync(marker) && fs.existsSync(path.join(directory, "config.json")) && hasModelWeights(directory);
  const sizeBytes = directorySize(directory);
  const operation = operations.get(modelId);
  const activeDownload = operation?.status === "downloading";
  const progress = activeDownload
    ? Math.min(99, Math.max(1, Math.round((sizeBytes / model.approximateBytes) * 100)))
    : installed ? 100 : 0;
  return {
    installed,
    downloading: activeDownload,
    status: activeDownload ? "downloading" : installed ? "installed" : operation?.status === "failed" ? "failed" : "missing",
    progress,
    sizeBytes,
    directory,
    error: operation?.status === "failed" ? operation.error : "",
  };
}

function runtimeState() {
  if (cachedRuntimeState) return cachedRuntimeState;
  const pythonReady = fs.existsSync(PYTHON_PATH);
  let downloaderReady = false;
  if (pythonReady) {
    const result = require("child_process").spawnSync(PYTHON_PATH, ["-c", "import modelscope"], { windowsHide: true, stdio: "ignore" });
    downloaderReady = result.status === 0;
  }
  cachedRuntimeState = { pythonReady, downloaderReady };
  return cachedRuntimeState;
}

function analysisModelState() {
  const config = readJson(ANALYSIS_MODEL_CONFIG_PATH);
  const model = String(config.model || "").trim();
  const configured = Boolean(model && String(config.baseUrl || "").trim() && String(config.apiKey || "").trim() && !String(config.apiKey).startsWith("replace-"));
  return {
    configured,
    model,
    label: "复用当前分析模型",
    purpose: "对语义召回结果做精排复核；首版不额外安装 reranker 模型。",
  };
}

function currentConfig() {
  const defaults = readJson(CONFIG_EXAMPLE_PATH, { schemaVersion: "1.0", activeModel: "lightweight" });
  const config = readJson(CONFIG_PATH, defaults);
  return {
    schemaVersion: "1.0",
    activeModel: MODELS[config.activeModel] ? config.activeModel : "lightweight",
  };
}

function publicModel(model) {
  return { ...model, ...installationState(model.id), selected: currentConfig().activeModel === model.id };
}

function getSettings() {
  const config = currentConfig();
  return {
    ...config,
    modelRoot: MODEL_ROOT,
    runtime: runtimeState(),
    models: Object.values(MODELS).map(publicModel),
    reranker: analysisModelState(),
    downloadSource: "ModelScope 国内源",
  };
}

function saveSettings(input) {
  const activeModel = String(input?.activeModel || "");
  modelDefinition(activeModel);
  writeJson(CONFIG_PATH, { schemaVersion: "1.0", activeModel });
  return getSettings();
}

function startDownload(modelId) {
  const model = modelDefinition(modelId);
  const existing = operations.get(modelId);
  if (existing?.status === "downloading") return getSettings();
  const runtime = runtimeState();
  if (!runtime.pythonReady) throw new Error("项目独立 Python 尚未安装，请先运行 npm run doctor。");
  if (!runtime.downloaderReady) throw new Error("缺少 huggingface_hub，请先补齐智能筛选模型下载依赖。");
  if (!fs.existsSync(DOWNLOAD_SCRIPT)) throw new Error("缺少模型下载脚本 scripts/manage_embedding_model.py。");

  const directory = modelDirectory(modelId);
  fs.mkdirSync(directory, { recursive: true });
  const operation = { status: "downloading", error: "", startedAt: new Date().toISOString(), output: "" };
  operations.set(modelId, operation);
  const child = spawn(PYTHON_PATH, [DOWNLOAD_SCRIPT, "download", "--source", "modelscope", "--repo-id", model.modelScopeId, "--target", directory], {
    cwd: PROJECT_ROOT,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
  });
  const capture = (chunk) => { operation.output = `${operation.output}${chunk}`.slice(-8000); };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  child.on("error", (error) => {
    operation.status = "failed";
    operation.error = error.message;
  });
  child.on("close", (code) => {
    if (code === 0 && installationState(modelId).installed) {
      operation.status = "installed";
      operation.error = "";
      return;
    }
    operation.status = "failed";
    operation.error = operation.output.trim().split(/\r?\n/).slice(-2).join(" ") || `下载进程异常退出（${code}）。`;
  });
  return getSettings();
}

async function deleteModel(modelId) {
  modelDefinition(modelId);
  if (operations.get(modelId)?.status === "downloading") throw new Error("模型正在下载，请等待完成后再删除。");
  const directory = modelDirectory(modelId);
  await fs.promises.rm(directory, { recursive: true, force: true });
  operations.delete(modelId);
  return getSettings();
}

module.exports = {
  MODELS,
  deleteModel,
  getSettings,
  installationState,
  modelDirectory,
  saveSettings,
  startDownload,
};
