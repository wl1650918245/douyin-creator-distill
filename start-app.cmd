@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Project dependencies are missing. Run npm ci first.
  pause
  exit /b 1
)

start "" /min powershell.exe -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8780/'"
echo Starting CreatorDistill at http://127.0.0.1:8780/
echo Keep this window open. Press Ctrl+C to stop the service.
npm start
