@echo off
if "%~1"=="" (
  echo usage: watch-log.cmd ^<logfile^>
  exit /b 2
)
title WeChat Sidecar Log
chcp 65001 >nul
powershell -NoProfile -NoExit -Command "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; Get-Content -LiteralPath '%~1' -Encoding UTF8 -Wait -Tail 20"
