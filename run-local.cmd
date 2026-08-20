@echo off
REM Double-clickable wrapper so you don't have to fight PowerShell's execution policy.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-local.ps1" %*
pause
