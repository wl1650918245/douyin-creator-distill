# 本地运行时目录

这个目录属于当前智能体，不允许运行时引用其他项目的 FFmpeg、Whisper 模型或 Python 环境。

实际二进制和模型体积较大，不提交到 Git：

- `bin/ffmpeg/ffmpeg.exe`：音视频处理程序。
- `models/faster-whisper-small/`：本地 Whisper small 模型。
- `python/.venv/`：当前项目独立的 Python 3.12 虚拟环境。

首次部署或复制到另一台电脑后，运行：

```powershell
npm run doctor
```

诊断会逐项检查 Node.js、Python、faster-whisper、FFmpeg 和模型文件，不会读取密钥，也不会发起抖音抓取。

当前随项目复制的 FFmpeg 构建为 Gyan Essentials GPL 构建。内部本地使用已经验证；对外分发安装包前，必须单独完成许可证审查，或改为由安装器引导用户从官方/可信来源安装兼容构建。
