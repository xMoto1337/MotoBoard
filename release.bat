@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -NoExit -File "release.ps1"
pause
