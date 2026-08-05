param(
  [string]$PythonCommand = "py"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot "runtime\python"
$VenvRoot = Join-Path $RuntimeRoot ".venv"
$PythonExe = Join-Path $VenvRoot "Scripts\python.exe"

if (-not (Test-Path -LiteralPath $PythonExe)) {
  Write-Host "[1/4] 创建项目独立 Python 3.12 虚拟环境"
  if ($PythonCommand -eq "py") {
    & py -3.12 -m venv $VenvRoot
  } else {
    & $PythonCommand -m venv $VenvRoot
  }
}

Write-Host "[2/4] 更新项目虚拟环境安装器"
& $PythonExe -m pip install --disable-pip-version-check --upgrade pip

Write-Host "[3/4] 安装本地 Whisper 与下载依赖"
& $PythonExe -m pip install --disable-pip-version-check -r (Join-Path $RuntimeRoot "requirements.txt")

Write-Host "[4/4] 安装 CPU 向量推理依赖"
& $PythonExe -m pip install --disable-pip-version-check --index-url https://download.pytorch.org/whl/cpu torch==2.9.1
& $PythonExe -m pip install --disable-pip-version-check -r (Join-Path $RuntimeRoot "embedding-requirements.txt")

Write-Host "项目独立 Python 环境已就绪。请继续运行 npm run doctor。"
