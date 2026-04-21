# Changelog

All notable changes to Pulse are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.1] — 2026-04-21

### Added

- `pulse config host [--client H] [--dashboard H]` — show/change bind hosts. Use `0.0.0.0` to expose the API or dashboard on the LAN (e.g. reach it from your phone); `127.0.0.1` keeps it localhost-only. Warns when exposing over plain HTTP and auto-restarts affected services.
- `pulse config secure <on|off>` — toggle `AUTH_COOKIE_SECURE`. `on` when behind HTTPS / reverse proxy (production); `off` for development over plain HTTP.
- `pulse config rotate-jwt [-y|--yes]` — regenerates `AUTH_JWT_SECRET`. Confirms first because it kicks every active login back to `/login`.

With this rollup every env in `client.env` and `frontend.env` is now reachable through a `pulse config`/`pulse keys` subcommand — no need to edit `.env` files by hand for day-to-day operation.

### Added (cont.)

- **Terminal capture modal** — a floating button in the top-right corner of every pane (both desktop and mobile, semi-transparent until hovered) opens a modal with the pane's scrollback rendered as plain text in a read-only textarea. Users can select freely with mouse/touch, filter by substring, copy to clipboard, or download as `.txt`. Works consistently inside alt-screen CLI apps (Claude Code, Cursor, `less`, `vim`) where xterm's own text selection is unreliable.
- Client endpoint `GET /api/sessions/{id}/capture?lines=N` — returns the pane's buffer via `tmux capture-pane -p -S -N` (default 500 lines, max 50000).

### Changed

- Notes FAB now uses the same `primary` color as the new "Copy" button so both floating actions read as a cohesive set, while keeping the FAB solid (not tinted) for affordance.

## [1.4.0] — 2026-04-21

### Added

- `pulse config` editor settings page — a new **Editor** tab in Settings lets you override the binary path used by "Open in VSCode" per server. Useful when the editor is installed somewhere Pulse's auto-detect doesn't know about. Includes an **Auto-detect** button that does a dry-run of the resolver and tells you which path it would use (override / PATH / well-known install location).
- Client endpoint `PUT /api/settings/editor` (override path, validated against `os.path.isfile` + `os.access(..., X_OK)`) and `POST /api/settings/editor/resolve` (dry-run resolver).
- Editor binary resolver now handles **Cursor**, **VSCodium**, **Windsurf**, VSCode Insiders, and standard VSCode installs on **macOS** (`/Applications/<App>.app/Contents/Resources/app/bin/<cli>`) in addition to the existing Linux paths. Any of `code`, `cursor`, `codium`, `code-insiders`, `windsurf` on PATH is accepted.

### Fixed

- "Open in VSCode" failing with `errors.editor_binary_not_found` on macOS when VSCode was installed but the `code` CLI wasn't added to PATH (a common case — users have to run `Shell Command: Install 'code' command in PATH` manually). The new fallbacks cover all `.app` installs directly.
- Error message for `errors.editor_binary_not_found` updated to mention Cursor/VSCodium and point users to the new Editor settings tab.
- Dashboard crashlooping on macOS for users who have Node installed via a version manager (nvm, fnm, asdf). The `ensure_node()` check in the installer looked at the shell's `node -v`, and if it found a modern version (e.g. nvm's `v25.1.0`), it skipped the brew install — but launchd never sees nvm/fnm/asdf, so the service fell back to `/usr/local/bin/node` or similar and Next.js refused to start. The installer now always `brew install node@20` on macOS regardless of what the shell `node` reports, and force-links it so the launchd PATH can always find it.

## [1.3.3] — 2026-04-21

### Fixed

- Dashboard stuck in a crashloop on macOS when a Node.js version below 18.18 was present in `/usr/local/bin/node` or elsewhere on the launchd PATH. Next.js 15 refused to start, logging `You are using Node.js 18.16.1. For Next.js, Node.js version "^18.18.0 || ^19.8.0 || >= 20.0.0" is required.` and launchd restarted the process in a loop. The launchd plist wrapper now loads brew's shellenv and walks a small list of formulas (`node@20`, `node@22`, `node@18`, `node`) at start time, prepending the first installed one to `PATH`. Works on Apple Silicon and Intel without substitution in the installer.

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

[Unreleased]: https://github.com/kevinzezel/pulse/compare/v1.4.1...HEAD
[1.4.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.1
[1.4.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.0
[1.3.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.3
[1.3.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.2
[1.3.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.1
[1.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.0
[1.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.2.0
