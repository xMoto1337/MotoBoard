@echo off
cd /d "%~dp0"
echo Cleaning Rust build cache...
cd src-tauri
cargo clean
cd ..
echo Done! Run run.bat to start fresh.
pause
