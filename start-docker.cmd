@echo off
setlocal
cd /d "%~dp0"

where docker >nul 2>&1
if errorlevel 1 (
  echo Docker CLI not found. Install Docker Desktop first.
  pause
  exit /b 1
)

docker info >nul 2>&1
if errorlevel 1 (
  echo Starting Docker Desktop...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  :wait_docker
  timeout /t 3 /nobreak >nul
  docker info >nul 2>&1
  if errorlevel 1 goto wait_docker
)

docker compose up -d --wait
if errorlevel 1 (
  echo Startup failed. Inspect logs with: docker compose logs app
  pause
  exit /b 1
)

docker compose ps
echo.
echo Companion API: http://127.0.0.1:3000/health
pause
