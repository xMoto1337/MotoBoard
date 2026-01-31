$Host.UI.RawUI.WindowTitle = "MotoBoard - Key Generator"

Clear-Host
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   MOTOBOARD - KEY GENERATOR" -ForegroundColor Green
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  This will generate your update signing keys." -ForegroundColor White
Write-Host "  You only need to run this " -NoNewline
Write-Host "ONCE" -ForegroundColor Yellow -NoNewline
Write-Host "." -ForegroundColor White
Write-Host ""
Write-Host "  IMPORTANT: " -ForegroundColor Red -NoNewline
Write-Host "Remember the password you set!" -ForegroundColor White
Write-Host ""
Read-Host "  Press Enter to continue"

Write-Host ""
Write-Host "  Generating keys..." -ForegroundColor Yellow
Write-Host ""

npx tauri signer generate -w "$env:USERPROFILE\.tauri\motoboard.key"

Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host "   NEXT STEPS:" -ForegroundColor Yellow
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Write-Host "  1. " -ForegroundColor Cyan -NoNewline
Write-Host "Copy the PUBLIC KEY shown above"
Write-Host ""
Write-Host "  2. " -ForegroundColor Cyan -NoNewline
Write-Host "Paste it in src-tauri\tauri.conf.json"
Write-Host "     (replace REPLACE_WITH_YOUR_PUBLIC_KEY)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  3. " -ForegroundColor Cyan -NoNewline
Write-Host "Go to GitHub repo Settings > Secrets > Actions"
Write-Host "     Add these secrets:" -ForegroundColor DarkGray
Write-Host ""
Write-Host "     TAURI_PRIVATE_KEY " -ForegroundColor Yellow -NoNewline
Write-Host "= contents of:"
Write-Host "     $env:USERPROFILE\.tauri\motoboard.key" -ForegroundColor DarkGray
Write-Host ""
Write-Host "     TAURI_KEY_PASSWORD " -ForegroundColor Yellow -NoNewline
Write-Host "= your password"
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Green
Write-Host ""
Read-Host "  Press Enter to exit"
