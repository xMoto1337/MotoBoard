@echo off
set PATH=%PATH%;C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin
cd /d C:\Users\wesle\Documents\MotoBoard
echo Starting MotoBoard...
call "C:\Program Files\nodejs\npm.cmd" run tauri dev
pause
