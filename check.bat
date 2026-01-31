@echo off
set PATH=C:\Program Files\nodejs;%PATH%
cd /d C:\Users\wesle\Documents\MotoBoard
call "C:\Program Files\nodejs\npx.cmd" tsc --noEmit > check_output.txt 2>&1
echo Done.
