# Changelog

All notable changes to Pulse are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.2] — 2026-04-21

### Fixed

- `pulse upgrade` crashing at the end with `Syntax error: "(" unexpected` on Debian/Ubuntu (dash). Root cause: `install.sh` overwrites `~/.local/bin/pulse` while dash is still reading it, so the parser's byte offset lands inside new-file content. Fix: `cmd_upgrade` now `exec`s the installer, replacing this shell instead of returning to it.
- `pulse help` and `pulse config` printing literal `\033[1m` escape sequences instead of formatting. The color variables stored backslash-escapes as strings, which `printf "%b"` expanded correctly but `cat <<EOF` did not. Fix: the setup block now materializes the variables as real ESC bytes via `$(printf '\033')`, so heredocs, `printf`, and `echo` all render them identically.

## [1.3.0] — 2026-04-21

### Added

- `pulse config password` — change the dashboard password interactively (or via `--stdin` / `PULSE_AUTH_PASSWORD`). Auto-restarts the dashboard.
- `pulse config ports` — show or change the client/dashboard ports. With `--client N` / `--dashboard N` it updates both `.env` files, keeps `servers.json`'s localhost entry in sync, and restarts the affected services.
- `pulse config paths` — print the install, config, logs, data, binary, and service-unit paths.
- `pulse config open <config|install|logs|data>` — open that directory in the system file manager.

### Fixed

- **Terminal panes auto-deleted with "Session ended" right after opening**, when Pulse ran under systemd/launchd. Root cause: `tmux attach-session` exits immediately without `TERM`, which systemd/launchd user units don't inherit from a shell. The client now injects `TERM=xterm-256color` before spawning tmux, and the systemd/launchd unit templates also set `TERM` as a belt-and-suspenders fallback.
- WebSocket handler now treats Starlette 1.0's `RuntimeError("WebSocket is not connected...")` as a clean disconnect instead of logging it as an error. That error was being raised when `send_output` closed the socket (e.g. on session-end) at the same moment the main loop was waiting on `receive_text`.

## [1.2.0] — 2026-04-21

First public release.

### Added

- One-line installer (`curl … | sh`) for Linux, macOS, and Windows (via WSL2).
- `pulse` CLI umbrella command — `status`, `start`, `stop`, `restart`, `logs`, `open`, `upgrade`, `uninstall`, `keys show/regen`, `config edit`, `version`, `check-updates`.
- systemd user units (Linux / WSL) and launchd LaunchAgents (macOS) with auto-start on login and automatic restart on failure.
- Windows installer (`install.ps1`) that verifies WSL2, delegates to the Linux installer, and creates a Start Menu shortcut + `pulse.cmd` on PATH.
- English as the default frontend locale.
- MIT license, CONTRIBUTING, SECURITY, and Code of Conduct.
- GitHub Actions release pipeline that publishes a tarball + installer scripts on tag push.

### Changed

- **Renamed `backend/` → `client/`.** The service running on the host is now called the Pulse *client* — a clearer name for an agent that can run locally or on a remote server managed from the dashboard.
- Default frontend locale is now English (was pt-BR). pt-BR and es remain fully supported and auto-selected when the browser language matches.
- Shared bootstrap helpers extracted to `install/lib/` so `client/start.sh` and `frontend/start.sh` share OS-detection and dependency-install logic.
- Installer now verifies the release tarball against the published `SHA256SUMS` and aborts on mismatch.
- Installer pins the client venv's Python to the version in `client/.python-version` (3.12), letting `uv` download it if the system doesn't have it. Prevents broken venvs when users run under pyenv/asdf with an older default.
- Installer now validates the system `python3` is ≥ 3.10 and fails fast with a clear message if not.
- Installer adds `~/.local/bin` to the active shell's rc file (bash/zsh) automatically when it isn't already on `PATH`, instead of only printing a reminder.
- Bumped minimum Node.js to 18.18 (was 18.17) to match Next.js 15 requirements.
- `pulse upgrade` now forwards `PULSE_CLIENT_ONLY`, `PULSE_DASHBOARD_ONLY`, `PULSE_NO_START`, and port overrides to the installer, so upgrades don't silently change install shape.
- Windows installer (`install.ps1`) forwards the full set of `PULSE_*` env vars into WSL — previously `PULSE_DASHBOARD_ONLY`, `PULSE_NO_START`, `PULSE_CLIENT_PORT`, and `PULSE_DASHBOARD_PORT` were dropped.

### Fixed

- Installer no longer leaves the terminal in `-echo` state if the user hits Ctrl+C during the dashboard password prompt.
- Installer now announces the sudo prompt before `loginctl enable-linger` instead of silently asking for a password mid-install.

### Notes

Migration from earlier dev builds: see the README "Self-hosting" section and run `./start.sh` once — it regenerates `.env` files with sane defaults.

[Unreleased]: https://github.com/kevinzezel/pulse/compare/v1.3.2...HEAD
[1.3.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.2
[1.3.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.1
[1.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.0
[1.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.2.0
