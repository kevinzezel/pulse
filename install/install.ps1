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

# wsl.exe emits UTF-16 LE by default. In Windows PowerShell 5.1 with a non-UTF-8
# console code page (Windows-1252 on pt-BR systems, etc.), embedded NUL bytes
# corrupt pipeline line-splitting — $_.Trim() explodes when $_ becomes a [char].
# Also makes the banner's box-drawing chars render correctly on PS 5.1.
$OutputEncoding           = [System.Text.UTF8Encoding]::new()
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
[Console]::InputEncoding  = [System.Text.UTF8Encoding]::new()
$env:WSL_UTF8             = '1'

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

# Run wsl.exe and return stdout as a clean [string[]] — always an array.
# Strips NUL bytes (UTF-16 leftovers on WSL builds older than 0.64) and a
# UTF-8 BOM, trims each line, filters empties. The leading comma in
# `return ,@($arr)` is critical on PS 5.1: without it, single-element arrays
# degrade to a bare [string], and indexing with [0] returns [char] — which
# has no .Trim() and reproduces the original crash.
function Invoke-Wsl {
    param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WslArgs)
    $raw = & wsl.exe @WslArgs 2>$null
    if ($null -eq $raw) { return ,@() }
    $arr = @($raw) | ForEach-Object {
        $s = [string]$_
        $s = $s -replace "`0",''
        if ($s.Length -gt 0 -and [int][char]$s[0] -eq 0xFEFF) { $s = $s.Substring(1) }
        $s.Trim()
    } | Where-Object { $_ -ne '' }
    return ,@($arr)
}

function Test-Wsl2 {
    # True if wsl.exe is on PATH and at least one distro is installed.
    if (-not (Get-Command wsl -ErrorAction SilentlyContinue)) { return $false }
    try {
        $distros = Invoke-Wsl -l -q
        return ($distros.Count -gt 0)
    } catch {
        return $false
    }
}

function Get-DefaultDistro {
    # Returns the name of the default distro, or exits with a clear message
    # if it's a WSL1 distro (systemctl --user would crash later) or a
    # container-engine VM like docker-desktop (no apt, install.sh would crash).
    $lines = Invoke-Wsl -l -v | Select-Object -Skip 1
    foreach ($line in $lines) {
        # Columns: [*] NAME STATE VERSION — header (localized) already skipped.
        if ($line -match '^\s*\*\s+(.+?)\s+\S+\s+(\d+)\s*$') {
            $name = $Matches[1].Trim()
            $ver  = [int]$Matches[2]
            if ($ver -ne 2) {
                Write-ErrExit "Default WSL distro '$name' is WSL$ver. Pulse requires WSL2. Run: wsl --set-version `"$name`" 2"
            }
            if ($name -match '^(docker-desktop|rancher-desktop)') {
                Write-ErrExit "Default WSL distro '$name' is a container-engine VM, not a user distro. Set a real default: wsl --set-default <ubuntu-or-similar>"
            }
            return $name
        }
    }
    # Fallback when no '*' line matched (unusual — but better than nothing).
    $distros = Invoke-Wsl -l -q
    if ($distros.Count -gt 0) { return $distros[0] }
    return $null
}

function Test-WslSystemd {
    # Pulse uses systemd user units. Without systemd the Linux installer
    # would crash halfway through on `systemctl --user enable --now`.
    $distro = Get-DefaultDistro
    if (-not $distro) { return $false }
    $check = Invoke-Wsl -d "$distro" -- sh -c 'pidof systemd >/dev/null 2>&1 && echo ok || echo no'
    return ($check.Count -gt 0 -and $check[0] -eq 'ok')
}

function Invoke-WslBootstrap {
    $distro = Get-DefaultDistro
    if (-not $distro) { Write-ErrExit 'no WSL distro found' }
    Write-Status "running Linux installer inside WSL distro: $distro"
    $rawUrl = "https://raw.githubusercontent.com/$Repo/main/install/install.sh"

    # Forward PULSE_* env vars to WSL via the native $WSLENV bridge. Previously
    # these were interpolated into `bash -c "VAR='...' ..."`, which silently
    # mangled passwords containing ', `, $, %, etc.
    $passthrough = @(
        'PULSE_VERSION','PULSE_CLIENT_ONLY','PULSE_DASHBOARD_ONLY','PULSE_NO_START',
        'PULSE_AUTH_PASSWORD','PULSE_NO_INTERACT','PULSE_CLIENT_PORT','PULSE_DASHBOARD_PORT'
    )
    $forward = @()
    foreach ($v in $passthrough) {
        if ([Environment]::GetEnvironmentVariable($v)) { $forward += "$v/u" }
    }
    if ($forward.Count -gt 0) {
        $sep = if ($env:WSLENV) { ':' } else { '' }
        $env:WSLENV = "$($env:WSLENV)$sep$($forward -join ':')"
    }

    & wsl -d "$distro" -- bash -c "curl -fsSL '$rawUrl' | sh"
    if ($LASTEXITCODE -ne 0) { Write-ErrExit "WSL install failed (exit code $LASTEXITCODE)" }
}

function Install-WindowsShortcuts {
    # Skip the dashboard shortcut on client-only installs — would point nowhere.
    if ($env:PULSE_CLIENT_ONLY) {
        Write-Status 'client-only install; skipping dashboard shortcut'
        return $null
    }

    $distro = Get-DefaultDistro
    $portLines = Invoke-Wsl -d "$distro" -- bash -c 'grep -E "^WEB_PORT=" "$HOME/.config/pulse/frontend.env" 2>/dev/null | cut -d= -f2-'
    $port = if ($portLines.Count -gt 0 -and $portLines[0] -match '^\d+$') { $portLines[0] } else { '3000' }
    $dashboardUrl = "http://localhost:$port"

    # Start Menu shortcut → opens browser at dashboard URL
    $shortcutDir  = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
    $shortcutPath = Join-Path $shortcutDir 'Pulse Dashboard.lnk'
    $wshShell = New-Object -ComObject WScript.Shell
    $sc = $wshShell.CreateShortcut($shortcutPath)
    $sc.TargetPath   = 'rundll32.exe'
    $sc.Arguments    = "url.dll,FileProtocolHandler $dashboardUrl"
    $sc.IconLocation = "$env:SystemRoot\System32\url.dll,0"
    $sc.Description  = 'Open the Pulse self-hosted dashboard'
    $sc.Save()
    Write-Status "Start Menu shortcut: $shortcutPath"

    # pulse.cmd delegator. OEM encoding (cmd.exe's active code page) preserves
    # non-ASCII distro names that ASCII would replace with '?'. Quoting the
    # distro name also survives names with spaces.
    if (-not $env:LOCALAPPDATA) { Write-ErrExit 'LOCALAPPDATA env var is not set — cannot install pulse.cmd' }
    $pulseCmdDir = Join-Path $env:LOCALAPPDATA 'Pulse'
    [void][System.IO.Directory]::CreateDirectory($pulseCmdDir)
    $pulseCmdPath = Join-Path $pulseCmdDir 'pulse.cmd'
    $cmdContent = @"
@echo off
wsl -d "$distro" -- pulse %*
"@
    Set-Content -Path $pulseCmdPath -Value $cmdContent -Encoding OEM
    Write-Status "pulse.cmd: $pulseCmdPath"

    # Add Pulse dir to user PATH if not already present.
    # Normalize trailing backslash so reinstalls don't duplicate the entry.
    $normalized = $pulseCmdDir.TrimEnd('\')
    $userPath   = [Environment]::GetEnvironmentVariable('PATH', 'User')
    $alreadyPresent = $false
    if ($userPath) {
        $alreadyPresent = @($userPath -split ';' | ForEach-Object { $_.TrimEnd('\') } | Where-Object { $_ -ieq $normalized }).Count -gt 0
    }
    if (-not $alreadyPresent) {
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

if (-not (Test-WslSystemd)) {
    Write-Warn "systemd is not running inside your WSL distro."
    Write-Host ""
    Write-Host "Pulse uses systemd user units. Enable it once, then re-run:"
    Write-Host ""
    Write-Host "  1) In WSL:         sudo sh -c 'printf `"[boot]\nsystemd=true\n`" >> /etc/wsl.conf'"
    Write-Host "  2) In PowerShell:  wsl --shutdown"
    Write-Host "  3) Wait a few seconds, then re-run this installer."
    Write-Host ""
    exit 1
}

Invoke-WslBootstrap
$url = Install-WindowsShortcuts
if ($url) { Show-Success $url }
