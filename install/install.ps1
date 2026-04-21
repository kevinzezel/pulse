# Pulse installer for Windows — github.com/kevinzezel/pulse
#
# Usage (PowerShell):
#   irm https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.ps1 | iex
#
# Requires Windows 10 build 19041+ with WSL2. If WSL2 is not installed, the
# script aborts with instructions. Inside WSL, the standard Linux installer
# runs. A shortcut is placed in the Start Menu and `pulse.cmd` in %LOCALAPPDATA%
# delegates CLI calls to the WSL installation.

$ErrorActionPreference = 'Stop'

$RepoOwner = 'kevinzezel'
$RepoName  = 'pulse'
$Repo      = "$RepoOwner/$RepoName"

function Write-Status  ($msg) { Write-Host "[pulse] $msg" -ForegroundColor Green }
function Write-Warn    ($msg) { Write-Host "[pulse] $msg" -ForegroundColor Yellow }
function Write-ErrExit ($msg) { Write-Host "[pulse] $msg" -ForegroundColor Red; exit 1 }

function Show-Banner {
    @"

  ██████╗ ██╗   ██╗██╗     ███████╗███████╗
  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
  ██████╔╝██║   ██║██║     ███████╗█████╗
  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝
  ██║     ╚██████╔╝███████╗███████║███████╗
  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝
  Keep your terminals alive. (Windows / WSL2 installer)

"@
}

function Test-Wsl2 {
    # Returns $true if WSL2 is available and has at least one distro installed.
    $wslPath = Get-Command wsl -ErrorAction SilentlyContinue
    if (-not $wslPath) { return $false }
    # `wsl -l -q` lists distros (empty output means WSL engine is present but no distro yet)
    try {
        $distros = & wsl -l -q 2>$null | Where-Object { $_ -and $_.Trim() -ne '' }
        return ($distros.Count -gt 0)
    } catch {
        return $false
    }
}

function Get-DefaultDistro {
    # The first line of `wsl -l` after the header is the default distro (marked with " (Default)" on some locales).
    $lines = & wsl -l -v 2>$null | Select-Object -Skip 1
    foreach ($line in $lines) {
        if ($line -match '^\s*\*\s+(\S+)') { return $Matches[1] }
    }
    # Fallback: first distro from -l -q
    $distros = & wsl -l -q 2>$null | Where-Object { $_ -and $_.Trim() -ne '' }
    if ($distros.Count -gt 0) { return $distros[0].Trim() }
    return $null
}

function Invoke-WslBootstrap {
    $distro = Get-DefaultDistro
    if (-not $distro) { Write-ErrExit 'no WSL distro found' }
    Write-Status "running Linux installer inside WSL distro: $distro"
    $rawUrl = "https://raw.githubusercontent.com/$Repo/main/install/install.sh"
    # Pipe the env vars from the Windows shell through into wsl
    $envPrefix = ''
    if ($env:PULSE_VERSION)         { $envPrefix += "PULSE_VERSION='$($env:PULSE_VERSION)' " }
    if ($env:PULSE_CLIENT_ONLY)     { $envPrefix += "PULSE_CLIENT_ONLY='$($env:PULSE_CLIENT_ONLY)' " }
    if ($env:PULSE_DASHBOARD_ONLY)  { $envPrefix += "PULSE_DASHBOARD_ONLY='$($env:PULSE_DASHBOARD_ONLY)' " }
    if ($env:PULSE_NO_START)        { $envPrefix += "PULSE_NO_START='$($env:PULSE_NO_START)' " }
    if ($env:PULSE_AUTH_PASSWORD)   { $envPrefix += "PULSE_AUTH_PASSWORD='$($env:PULSE_AUTH_PASSWORD)' " }
    if ($env:PULSE_NO_INTERACT)     { $envPrefix += "PULSE_NO_INTERACT='$($env:PULSE_NO_INTERACT)' " }
    if ($env:PULSE_CLIENT_PORT)     { $envPrefix += "PULSE_CLIENT_PORT='$($env:PULSE_CLIENT_PORT)' " }
    if ($env:PULSE_DASHBOARD_PORT)  { $envPrefix += "PULSE_DASHBOARD_PORT='$($env:PULSE_DASHBOARD_PORT)' " }
    & wsl -d $distro -- bash -c "$envPrefix curl -fsSL '$rawUrl' | sh"
    if ($LASTEXITCODE -ne 0) { Write-ErrExit "WSL install failed (exit code $LASTEXITCODE)" }
}

function Install-WindowsShortcuts {
    # Read the dashboard port from inside WSL (from frontend.env)
    $distro = Get-DefaultDistro
    $port = & wsl -d $distro -- bash -c "grep -E '^WEB_PORT=' `$HOME/.config/pulse/frontend.env 2>/dev/null | cut -d= -f2-"
    if (-not $port) { $port = '3000' }
    $dashboardUrl = "http://localhost:$port"

    # Start Menu shortcut → opens browser at dashboard URL
    $shortcutDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shortcutPath = Join-Path $shortcutDir 'Pulse Dashboard.lnk'
    $wshShell = New-Object -ComObject WScript.Shell
    $sc = $wshShell.CreateShortcut($shortcutPath)
    $sc.TargetPath = 'rundll32.exe'
    $sc.Arguments  = "url.dll,FileProtocolHandler $dashboardUrl"
    $sc.IconLocation = "$env:SystemRoot\System32\url.dll,0"
    $sc.Description = 'Open the Pulse self-hosted dashboard'
    $sc.Save()
    Write-Status "Start Menu shortcut: $shortcutPath"

    # pulse.cmd delegating to WSL
    $pulseCmdDir = Join-Path $env:LOCALAPPDATA 'Pulse'
    [void][System.IO.Directory]::CreateDirectory($pulseCmdDir)
    $pulseCmdPath = Join-Path $pulseCmdDir 'pulse.cmd'
    @"
@echo off
wsl -d $distro -- pulse %*
"@ | Set-Content -Path $pulseCmdPath -Encoding ASCII
    Write-Status "pulse.cmd: $pulseCmdPath"

    # Add Pulse dir to PATH (user scope) if not already present
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    if (-not ($userPath -split ';' | Where-Object { $_ -eq $pulseCmdDir })) {
        $newPath = if ($userPath) { "$userPath;$pulseCmdDir" } else { $pulseCmdDir }
        [Environment]::SetEnvironmentVariable('PATH', $newPath, 'User')
        Write-Status "added $pulseCmdDir to user PATH (restart terminal to pick up)"
    }

    return $dashboardUrl
}

function Show-Success ($url) {
@"

╔════════════════════════════════════════════════════════════════════╗
║  Pulse installed on Windows (via WSL2)                             ║
╚════════════════════════════════════════════════════════════════════╝

  Dashboard:     $url
  Start Menu:    "Pulse Dashboard"
  CLI:           pulse status, pulse logs, pulse open  (restart terminal first)

"@
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
Show-Banner

if (-not (Test-Wsl2)) {
    Write-Warn "WSL2 is not installed (or has no Linux distro)."
    Write-Host ""
    Write-Host "Pulse on Windows runs inside WSL2 (so tmux is available)."
    Write-Host "Install WSL2 and try again:"
    Write-Host ""
    Write-Host "  1) Open PowerShell as Administrator"
    Write-Host "  2) Run: wsl --install"
    Write-Host "  3) Restart your PC"
    Write-Host "  4) Complete the Ubuntu setup when it launches"
    Write-Host "  5) Re-run this installer in PowerShell (non-admin):"
    Write-Host "       irm https://raw.githubusercontent.com/$Repo/main/install/install.ps1 | iex"
    Write-Host ""
    exit 1
}

Invoke-WslBootstrap
$url = Install-WindowsShortcuts
Show-Success $url
