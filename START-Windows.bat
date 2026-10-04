@echo off
title Restaurant Manager
cd /d "%~dp0"
if /i "%~1"=="/nobrowser" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\start.ps1" -NoBrowser
) else (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\start.ps1"
)
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 8 >nul
