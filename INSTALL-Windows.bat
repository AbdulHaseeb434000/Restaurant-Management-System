@echo off
title Restaurant Manager - Install
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\install.ps1" %*
if errorlevel 1 (
  echo.
  echo Installation FAILED. Read the message above, fix it and run this file again.
) 
echo.
pause
