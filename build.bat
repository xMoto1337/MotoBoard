@echo off
set PATH=%PATH%;C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin
cd /d C:\Users\wesle\Documents\MotoBoard
echo Building MotoBoard release...
call "C:\Program Files\nodejs\npm.cmd" run tauri build
echo.
echo Build complete! Find your app at:
echo src-tauri\target\release\motoboard.exe
pause
