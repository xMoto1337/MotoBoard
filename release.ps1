$Host.UI.RawUI.WindowTitle = "MotoBoard - Release Manager"

function Show-Header {
    Clear-Host
    Write-Host ""
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host "  =                                      =" -ForegroundColor Green
    Write-Host "  =   " -ForegroundColor Green -NoNewline
    Write-Host "M O T O B O A R D" -ForegroundColor White -NoNewline
    Write-Host "                 =" -ForegroundColor Green
    Write-Host "  =                                      =" -ForegroundColor Green
    Write-Host "  =        " -ForegroundColor Green -NoNewline
    Write-Host "RELEASE MANAGER" -ForegroundColor Yellow -NoNewline
    Write-Host "             =" -ForegroundColor Green
    Write-Host "  =                                      =" -ForegroundColor Green
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host ""
}

function Get-CurrentVersion {
    $cargoContent = Get-Content "src-tauri\Cargo.toml" -Raw
    $pattern = 'version\s*=\s*"([^"]+)"'
    if ($cargoContent -match $pattern) {
        return $matches[1]
    }
    return "1.0.0"
}

function Update-Version {
    param([string]$newVersion, [string]$oldVersion)

    $cargoPath = "src-tauri\Cargo.toml"
    $content = Get-Content $cargoPath -Raw
    $content = $content -replace ('version = "' + $oldVersion + '"'), ('version = "' + $newVersion + '"')
    Set-Content $cargoPath $content -NoNewline

    $tauriPath = "src-tauri\tauri.conf.json"
    $content = Get-Content $tauriPath -Raw
    $content = $content -replace ('"version": "' + $oldVersion + '"'), ('"version": "' + $newVersion + '"')
    Set-Content $tauriPath $content -NoNewline

    if (Test-Path "package.json") {
        $content = Get-Content "package.json" -Raw
        $content = $content -replace ('"version": "' + $oldVersion + '"'), ('"version": "' + $newVersion + '"')
        Set-Content "package.json" $content -NoNewline
    }
}

function Show-Menu {
    $currentVersion = Get-CurrentVersion

    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host "   Current Version: " -ForegroundColor White -NoNewline
    Write-Host "v$currentVersion" -ForegroundColor Green
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "   [" -NoNewline
    Write-Host "1" -ForegroundColor Cyan -NoNewline
    Write-Host "]  Push code only (no release)"
    Write-Host "   [" -NoNewline
    Write-Host "2" -ForegroundColor Cyan -NoNewline
    Write-Host "]  Create new release"
    Write-Host "   [" -NoNewline
    Write-Host "3" -ForegroundColor Cyan -NoNewline
    Write-Host "]  Exit"
    Write-Host ""

    return $currentVersion
}

function Push-CodeOnly {
    Clear-Host
    Write-Host ""
    Write-Host "  > Pushing code to GitHub..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Commit message: " -ForegroundColor Cyan -NoNewline
    $msg = Read-Host
    Write-Host ""

    git add .
    git commit -m $msg
    git push origin main

    Write-Host ""
    Write-Host "  Done! Code pushed successfully!" -ForegroundColor Green
    Write-Host ""
    Read-Host "  Press Enter to continue"
}

function New-Release {
    param([string]$currentVersion)

    Clear-Host
    Write-Host ""
    Write-Host "  > Create New Release" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "   Current version: v$currentVersion" -ForegroundColor DarkGray
    Write-Host "   Format: X.Y.Z (e.g., 1.0.1, 1.1.0, 2.0.0)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  New version number: " -ForegroundColor Cyan -NoNewline
    $newVersion = Read-Host

    if ([string]::IsNullOrWhiteSpace($newVersion)) {
        Write-Host ""
        Write-Host "  Error: Version cannot be empty!" -ForegroundColor Red
        Read-Host "  Press Enter to continue"
        return
    }

    Write-Host ""
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host "   Release Summary" -ForegroundColor White
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host "   Version:  " -NoNewline
    Write-Host "v$newVersion" -ForegroundColor Green
    Write-Host "   Tag:      " -NoNewline
    Write-Host "v$newVersion" -ForegroundColor Green
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  Proceed with release? (y/n): " -ForegroundColor Yellow -NoNewline
    $confirm = Read-Host

    if ($confirm -ne "y") {
        return
    }

    Write-Host ""
    Write-Host "  > Updating version in config files..." -ForegroundColor Yellow
    Update-Version -newVersion $newVersion -oldVersion $currentVersion
    Write-Host "  Done! Version updated to $newVersion" -ForegroundColor Green
    Write-Host ""

    Write-Host "  > Committing changes..." -ForegroundColor Yellow
    git add .
    git commit -m "Release v$newVersion"
    Write-Host "  Done! Changes committed" -ForegroundColor Green
    Write-Host ""

    Write-Host "  > Pushing to GitHub..." -ForegroundColor Yellow
    git push origin main
    Write-Host "  Done! Code pushed" -ForegroundColor Green
    Write-Host ""

    Write-Host "  > Creating release tag..." -ForegroundColor Yellow
    git tag "v$newVersion"
    git push origin "v$newVersion"
    Write-Host "  Done! Tag v$newVersion created and pushed" -ForegroundColor Green
    Write-Host ""

    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "  RELEASE v$newVersion INITIATED!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  GitHub Actions is now building your release." -ForegroundColor White
    Write-Host "  Check progress at:" -ForegroundColor White
    Write-Host "  https://github.com/xMoto1337/MotoBoard/actions" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  ----------------------------------------" -ForegroundColor DarkGray
    Write-Host ""
    Read-Host "  Press Enter to continue"
}

# Main loop
while ($true) {
    Show-Header
    $currentVersion = Show-Menu

    Write-Host "  Select option: " -ForegroundColor Cyan -NoNewline
    $choice = Read-Host

    switch ($choice) {
        "1" { Push-CodeOnly }
        "2" { New-Release -currentVersion $currentVersion }
        "3" { exit }
    }
}
