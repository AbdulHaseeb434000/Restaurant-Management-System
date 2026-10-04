@echo off
title Restaurant Manager - Stop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\stop.ps1"
timeout /t 3 >nul
