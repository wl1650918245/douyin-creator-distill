const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const input = process.argv[2];
if (!input || !fs.existsSync(input)) {
  console.error("用法：npm run whisper:smoke -- <本地视频或音频文件>");
  process.exit(2);
}

const outputDir = path.join(os.tmpdir(), "douyin-creator-distill-whisper-smoke");
fs.mkdirSync(outputDir, { recursive: true });
const metadataPath = path.join(outputDir, "metadata.json");
fs.writeFileSync(metadataPath, JSON.stringify({
  title: "本地 Whisper 烟雾测试",
  video_id: "smoke-test",
  video_url: "",
  published_at: new Date().toISOString().slice(0, 10),
  creator: "运行环境诊断",
  douyin_id: "smoke-test",
  content_type: "video",
}, null, 2), "utf8");

const child = spawn(path.join(root, "runtime", "python", ".venv", "Scripts", "python.exe"), [
  path.join(root, "scripts", "whisper_worker.py"),
  "--input", path.resolve(input),
  "--output-dir", outputDir,
  "--ffmpeg", path.join(root, "runtime", "bin", "ffmpeg", "ffmpeg.exe"),
  "--model-dir", path.join(root, "runtime", "models", "faster-whisper-small"),
  "--metadata", metadataPath,
], { stdio: "inherit", windowsHide: true });
child.on("exit", (code) => process.exit(code ?? 1));
