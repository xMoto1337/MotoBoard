@echo off
set PATH=%PATH%;C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin
cd /d C:\Users\wesle\Documents\MotoBoard
echo Installing npm dependencies...
call "C:\Program Files\nodejs\npm.cmd" install
echo.
echo Dependencies installed!
echo.
echo To run the app in development mode:
echo   npm run tauri dev
echo.
pause
