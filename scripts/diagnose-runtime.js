const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const runtime = {
  ffmpeg: path.join(root, "runtime", "bin", "ffmpeg", "ffmpeg.exe"),
  python: path.join(root, "runtime", "python", ".venv", "Scripts", "python.exe"),
  model: path.join(root, "runtime", "models", "faster-whisper-small", "model.bin"),
  embeddingRoot: path.join(root, "runtime", "models", "embedding"),
};

function checkFile(label, filepath, minimumBytes = 1) {
  const exists = fs.existsSync(filepath);
  const size = exists ? fs.statSync(filepath).size : 0;
  const ok = exists && size >= minimumBytes;
  console.log(`${ok ? "[通过]" : "[失败]"} ${label}: ${filepath}${exists ? ` (${(size / 1024 / 1024).toFixed(1)} MB)` : ""}`);
  return ok;
}

function run(label, executable, args) {
  if (!fs.existsSync(executable)) return false;
  const result = spawnSync(executable, args, { encoding: "utf8", windowsHide: true });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim().split(/\r?\n/)[0] || "无版本输出";
  const ok = result.status === 0;
  console.log(`${ok ? "[通过]" : "[失败]"} ${label}: ${output}`);
  return ok;
}

const checks = [
  checkFile("FFmpeg", runtime.ffmpeg, 10 * 1024 * 1024),
  checkFile("Whisper small 模型", runtime.model, 400 * 1024 * 1024),
  checkFile("项目独立 Python", runtime.python, 100 * 1024),
  run("FFmpeg 可执行性", runtime.ffmpeg, ["-version"]),
  run("faster-whisper 依赖", runtime.python, ["-c", "import faster_whisper; print(faster_whisper.__version__)"]),
  run("智能筛选模型国内下载依赖", runtime.python, ["-c", "import modelscope; print(modelscope.__version__)"]),
  run("智能筛选本地推理依赖", runtime.python, ["-c", "import torch, transformers, sentence_transformers; print('torch=' + torch.__version__ + ', transformers=' + transformers.__version__ + ', sentence-transformers=' + sentence_transformers.__version__)"]),
];

for (const [modelId, label] of [["lightweight", "轻量语义模型"], ["high_precision", "高精度语义模型"]]) {
  const marker = path.join(runtime.embeddingRoot, modelId, ".download-complete.json");
  console.log(`${fs.existsSync(marker) ? "[已安装]" : "[按需下载]"} ${label}: ${path.dirname(marker)}`);
}

if (checks.every(Boolean)) {
  console.log("[结论] 本地 Whisper 与智能筛选运行环境完整。");
  process.exit(0);
}
console.error("[结论] 运行环境不完整，请根据失败项补齐依赖。");
process.exit(1);
