# Changelog

All notable changes to Pulse are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.4.10] — 2026-04-22

### Fixed

- **`sessions.json` (and `compose-drafts.json`) silently stayed empty in install mode.** On a fresh Linux install the dashboard appeared to work — terminals opened, the UI listed them — but `~/.local/share/pulse/frontend/data/sessions.json` never grew past `{ "servers": {}, "updated_at": "…" }`, which also meant auto-restore after reboot had nothing to replay. The v1.4.9 `PULSE_FRONTEND_ROOT` fix was a red herring here: the file was being written to the correct path, just with an empty payload. Root cause was a mismatch between the installer and the API: `install/install.sh:seed_servers_json` seeded `data/servers.json` with `"id": "localhost"`, while `frontend/src/app/api/sessions/route.js` (and `frontend/src/app/api/compose-drafts/route.js`) only accepted server ids that started with `srv-` — a convention the UI's `POST /api/servers` satisfies (`srv-${randomUUID()}`) but the installer didn't. Every PUT from the snapshot effect matched no key, was silently normalized to `{}`, and returned 200. Dev mode (`./start.sh`) escaped the bug because it doesn't seed `servers.json` at all — the user creates the server from Settings → Servidores, where the id is generated in the right shape. Fix: the installer now generates a real UUID (`srv-$(uuidgen || /proc/sys/kernel/random/uuid)`) so new installs converge with the UI-created shape, and both API routes drop the `srv-` prefix requirement (the prefix was convention, not validation — the id is an object key, not a filesystem path, so any non-empty string is safe). Existing installs with `"id": "localhost"` keep working without migration.

### Changed

- `frontend/src/app/api/sessions/route.js` PUT accepts any non-empty server id string. `frontend/src/app/api/compose-drafts/route.js` regex no longer requires the `srv-` prefix (`^[A-Za-z0-9_-]+::[A-Za-z0-9_-]+$`). `install/install.sh:seed_servers_json` generates `srv-<uuid>` instead of the literal `localhost`.

## [1.4.9] — 2026-04-22

### Fixed

- `frontend/data/*.json` files (sessions, notes, prompts, flows, layouts, servers, compose-drafts) weren't being persisted in production installs, even though everything worked in `./start.sh` dev. Root cause: `jsonStore.readJsonFile` / `writeJsonFileAtomic` resolved paths against `process.cwd()`, and under systemd/launchd the process that actually handles writes doesn't always share the unit's `WorkingDirectory` with every internal worker Next spawns. Writes happened silently against a different path; no error, no log entry, the real file on disk just never changed. Fix: the dashboard unit/plist now set `PULSE_FRONTEND_ROOT=%h/.local/share/pulse/frontend` and `jsonStore` prefers that env var over `cwd`. Dev runs keep working via the `process.cwd()` fallback. `writeJsonFileAtomic` also now logs the failed absolute path on any exception so `pulse logs dashboard` can surface permission / path issues.
- **`pulse restart` was still killing tmux sessions.** v1.4.7 made the installer's `stop_services_if_running` use `systemctl kill --kill-who=main` (which signals only the main PID regardless of `KillMode`), so `pulse upgrade` stopped wiping tmux — but the companion change on the systemd unit template (`KillMode=process`) never made it into the commit. Any other `systemctl --user stop|restart pulse-client.service` — including `pulse restart` — still followed the default `KillMode=control-group` and took the tmux daemon down with it. The unit template now ships with `KillMode=process` as originally intended; `pulse restart` preserves live sessions.

### Changed

- `install/systemd/pulse.service.tmpl` picks up `PULSE_FRONTEND_ROOT`; `install/launchd/sh.pulse.dashboard.plist.tmpl` adds the same in `EnvironmentVariables`. Upgrading to 1.4.9 re-installs both so the next `pulse upgrade` / fresh install gets them without manual action.

## [1.4.8] — 2026-04-22

### Fixed

- `frontend/data/sessions.json` (the dashboard's per-server session metadata cache) wasn't being updated after creating or splitting a session when the server had been flagged offline by an earlier race. Sequence: dashboard loads → first `fetchSessions` hits the client while it's still booting → request fails → `offlineServerIds` keeps the server id. Moments later the client is up and `createSession` / `cloneSession` succeeds, so `sessions` state and the UI update — but the debounced snapshot effect still skipped the server because `offlineServerIds` was stale (`if (offlineSet.has(srv.id)) continue;`). The JSON file stayed at `{ "servers": {}, ... }` forever. Now `handleCreate` and `handleSplit` remove the server from `offlineServerIds` on success, so the next snapshot persists correctly.
- Auto-restore after reboot wasn't firing reliably. After a reboot tmux is gone, so the dashboard's startup flow — compare the sessions.json snapshot against live sessions and `POST /api/sessions/restore` any missing one (which runs `tmux new-session -c <cwd>` on the client) — is the only way sessions come back at the right path. Two issues made it miss: (a) the restore loop also gated on `offlineServerIds`, so a client that booted a second behind the dashboard never got its sessions restored; (b) `restoreAttemptedRef` flipped to true on the first try regardless of outcome, so even after the client came online a few seconds later, no retry ever happened. The gate is gone, and the ref now stays false until a request actually reaches the client — when `fetchSessions` later clears `offlineServerIds`, the effect re-fires and the restore goes through. Sessions come back at the same `cwd` they were in before the reboot.

### Changed

- Post-install summary now lists the full command set organized by purpose (service control, logs, keys, and every `pulse config` subcommand — password, ports, host, secure, rotate-jwt, paths, open, edit) instead of only five commands. Ends with a pointer to `pulse help` for the complete reference. Users no longer have to guess which subcommands exist — they're all printed right after installation.

## [1.4.7] — 2026-04-22

### Fixed

- **`pulse upgrade` was killing every live tmux session on Linux/WSL2.** The systemd user unit for the client didn't set `KillMode`, so the default (`control-group`) applied: `systemctl stop pulse-client.service` SIGTERMed the entire cgroup, taking the tmux server daemon down with it. The client spawns `tmux new-session -d`, which daemonises but — under cgroups v2 — stays in the unit's cgroup (fork doesn't escape the cgroup). Two fixes combined: (1) the unit template now declares `KillMode=process` so only the uvicorn PID gets signaled on future stops; (2) the installer's `stop_services_if_running` no longer uses `systemctl stop` — it uses `systemctl kill --kill-who=main --signal=TERM` instead, which signals only the main PID regardless of KillMode. That second change matters for *this* upgrade too: the installed unit file on disk still has the old KillMode default until after the upgrade finishes, and the new kill path sidesteps it. macOS/launchd was never affected (launchd terminates only the configured program, not a cgroup tree). `recover_sessions()` reattaches on next start.
- **`pulse upgrade` was wiping client-side user data** — Telegram bot/chat-id config, persisted session state, and anything else in `~/.local/share/pulse/client/data/` vanished on every upgrade. Notes, prompts, and flows (in `frontend/data/`) survived because `install_files()` already had backup/restore logic for that directory, but the matching block for the client was missing the same treatment — it just did `rm -rf $INSTALL_ROOT/client` and recopied. `install/install.sh:install_files` now mirrors the frontend's behavior for the client: move `client/data/` to `$TEMP_DIR` before wiping, then move it back after the fresh copy. Users on any earlier version should treat upgrades as data-destructive for client-side state until they're on 1.4.7+.
- Projects page couldn't scroll vertically on mobile (and anywhere the content was taller than the viewport) — the root container used `flex-1 overflow-y-auto`, but the parent `<main>` element is block-level, not a flex container, so `flex-1` had no effect and the div grew beyond the viewport without an overflow reference height. Switched to `h-full overflow-y-auto`, matching the Prompts and Settings pages.
- Settings tab bar (Servers / Telegram / Notifications / Editor) overflowed the viewport on narrow phones, triggering horizontal scroll on the whole page. The tab bar now scrolls horizontally inside itself (scrollbar hidden) with `whitespace-nowrap flex-shrink-0` on the buttons, so labels stay readable and the page stops stretching.
- Flows canvas background ignored the active theme on dark modes (Excalidraw's default `viewBackgroundColor` is `#ffffff`, which didn't match any of the 16 themed dark palettes). Newly created flows now default to `viewBackgroundColor: 'transparent'`, so the canvas inherits the themed container's `hsl(var(--background))`. Existing flows that had a user-chosen background color keep it (spread order preserves explicit scene state).
- Flows sidebar opened by default on mobile, covering the canvas. It now defaults to closed on mobile (open on desktop) on first visit; the user's explicit open/close preference is still persisted in `rt:flowsSidebarOpen` and respected on subsequent visits.

## [1.4.6] — 2026-04-22

### Fixed

- Telegram notifications from the client were shipped with pt-BR strings hardcoded in Python (`está aguardando há Ns`, `teste de notificação`), which bypassed the i18n catalog and ignored the user's locale. The browser channel had always respected i18n via the frontend `idleTitle` key — but the Telegram payload is composed inside the client's async `notification_watcher` loop, which has no incoming HTTP request to read `Accept-Language` from. Both strings are now in English, matching the project convention that external-facing messages default to English. Affected paths: `client/src/resources/notifications.py` (idle message) and `client/src/routes/settings.py` (test send button).

## [1.4.5] — 2026-04-21

### Fixed

- Under WSL2, the installer now binds `API_HOST` and `WEB_HOST` to `0.0.0.0` instead of `127.0.0.1`. Previously, the dashboard loaded in the Windows browser but couldn't reach the client API — fetches from the browser to `127.0.0.1:8000` failed because Windows `127.0.0.1` and WSL2 `127.0.0.1` are different loopbacks (WSL2 runs in its own Hyper-V network namespace). WSL2's `localhostForwarding` feature — the thing that makes `localhost:3000` on Windows reach the Next.js server inside WSL — only reflects bindings that listen on `0.0.0.0`; `127.0.0.1` stays invisible to Windows. Native Linux and macOS are unaffected and keep `127.0.0.1` as the safe default. `install.sh` uses the existing `PULSE_IS_WSL` detection to pick per-platform.

### Documentation

- New README section "Networking defaults" documenting the per-platform bind-host behavior, why WSL2 needs `0.0.0.0`, and how to use `pulse config host` to open access on the LAN (or revert to loopback-only on Linux/Mac).
- Expanded "Running the client on a remote server" into "Multiple servers — dashboard + remote clients" covering: `PULSE_CLIENT_ONLY` / `PULSE_DASHBOARD_ONLY` installs, firewall/NAT guidance for reaching remote clients, the Settings → Servers UI workflow (fields, probing, reorder), and a diagram of the typical multi-host architecture.
- Added `assets/demo.gif` (animated product tour) and 11 in-context screenshots — dashboard hero, projects list, notifications/telegram settings, editor override, prompts library, flows/Excalidraw, servers settings panel, mobile tab layout + MobileKeyBar, an Android browser notification, and a matching Telegram alert showing the last 20 lines of pane output — replacing most of the outstanding `TODO: add ...` placeholders.

## [1.4.4] — 2026-04-21

### Fixed

- Windows installer (`install/install.ps1`) crashing in `Invoke-Wsl` on Windows PowerShell 5.1 with `/bin/bash: line 1: Ubuntu: command not found`. Regression introduced in v1.4.3: the helper declared `param([Parameter(ValueFromRemainingArguments=$true)][string[]]$WslArgs)`, and on PS 5.1 that param binder treated tokens starting with `-` (like `-d` in `Invoke-Wsl -d Ubuntu ...`) as parameter-name attempts. No match was found, PS silently dropped the `-d`, and only the remaining args reached the binder — so `wsl -d Ubuntu -- sh -c '...'` executed as `wsl.exe Ubuntu -- sh -c '...'`, which asked WSL to run "Ubuntu" as a bash command. Switched the helper to the automatic `$args` variable, which bypasses the binder entirely and passes every token through verbatim.

## [1.4.3] — 2026-04-21

### Fixed

- **Windows installer (`install/install.ps1`) completely broken on Windows PowerShell 5.1** — crashed right after the banner with `[System.Char] não contém um método denominado 'Trim'`. Two root causes: (1) `wsl.exe` emits UTF-16 LE by default, so under Windows-1252 consoles (e.g. pt-BR) embedded NUL bytes corrupted pipeline line-splitting and `$_.Trim()` blew up when `$_` became a `[char]`; (2) `Get-DefaultDistro` indexed a single-string `$distros` with `[0]`, which returns `[char]` on PS 5.1 (no `.Trim()`). The script now forces UTF-8 on the console, sets `WSL_UTF8=1`, and routes all `wsl.exe` reads through an `Invoke-Wsl` helper that coerces to `[string]`, strips NUL/BOM, and always returns an array (uses `return ,@($arr)` — the leading comma is essential on PS 5.1 to preserve array shape for single-item results).
- Windows installer — additional Windows↔WSL interop hardening shipped in the same patch:
  - Abort clearly if the default WSL distro is WSL1 (was silently crashing minutes later in `systemctl --user`) or a container-engine VM like `docker-desktop`/`rancher-desktop` (minimal distro without `apt` — install.sh would fail).
  - Pass `PULSE_AUTH_PASSWORD` and the other `PULSE_*` env vars to WSL via `$WSLENV` (the native Windows↔WSL env bridge) instead of shell-interpolating into `bash -c "VAR='...' curl ..."`. Previously, passwords containing `'`, `` ` ``, `$`, `%`, or `"` were silently mangled — user set "my`pass" but got stored as "mypass".
  - Abort upfront if systemd is not enabled inside the WSL distro, with step-by-step instructions for `/etc/wsl.conf` + `wsl --shutdown`. Previously crashed deep inside `install.sh` with a cryptic `systemctl: command not found`.
  - `pulse.cmd` now quotes the distro name in the `wsl -d "..."` call (survives distros with spaces in the name) and is written with `Set-Content -Encoding OEM` instead of `ASCII` (survives non-ASCII distro names — ASCII was turning them into `?`).
  - `WEB_PORT` read from `frontend.env` now validates the value is numeric before using it; the fallback to `3000` no longer masks a silent parse failure.
  - User PATH deduplicates correctly on reinstall via trailing-backslash normalization — previously the same folder could be added multiple times.
  - Dashboard Start Menu shortcut and `pulse.cmd` are skipped when `PULSE_CLIENT_ONLY=1` (previously created a useless broken shortcut pointing at a nonexistent dashboard).
  - Validate `LOCALAPPDATA` is set before writing `pulse.cmd` instead of silently creating a relative-path file in the current directory.

## [1.4.2] — 2026-04-21

### Added

- `client/.env.example` and `frontend/.env.example` — both `start.sh` scripts try to copy `.env.example` → `.env` on first run, but the example files were missing from the repo, forcing new users to guess the variable names. `frontend/.env.example` ships with `AUTH_PASSWORD=change-me` (so `start.sh` fails fast until replaced) and `AUTH_JWT_SECRET=change-me` (auto-regenerated by `ensure_auth_secret` on first run).

### Fixed

- Dev runner (`client/start.sh`) was silently using the system Python (e.g. miniconda) instead of isolating deps in a `.venv`. Root cause: the script called `uv run uvicorn ...` with no `pyproject.toml` in the repo — without a project root, `uv run` does not create or use a project venv; it just executes the command against whatever interpreter it finds on PATH. If `uvicorn`/`fastapi` happened to be installed globally, it "worked" but ran outside any isolation. The script now creates `client/.venv` via `uv venv --python <.python-version>` and installs `requirements.txt` with `uv pip install`, then invokes `.venv/bin/uvicorn` directly — matching exactly what `install/install.sh` does in production (and what the systemd/launchd units execute).
- Removed the stale pip-based fallback path in `client/start.sh`. It was never exercised in practice (because `pulse_ensure_uv` always installs `uv` beforehand) and, if it had been, it would have masked a missing `uv` by installing deps into the system Python. The script now fails fast with a clear message if `uv` is not on `PATH`.
- Default `VERSION` written by `client/start.sh`'s `.env` generator bumped from `1.2.0` to `1.4.2` to match the actual release (was stale since 1.2.0 first public release).

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

[Unreleased]: https://github.com/kevinzezel/pulse/compare/v1.4.10...HEAD
[1.4.10]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.10
[1.4.9]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.9
[1.4.8]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.8
[1.4.7]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.7
[1.4.6]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.6
[1.4.5]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.5
[1.4.4]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.4
[1.4.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.3
[1.4.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.2
[1.4.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.1
[1.4.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.4.0
[1.3.3]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.3
[1.3.2]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.2
[1.3.1]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.1
[1.3.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.3.0
[1.2.0]: https://github.com/kevinzezel/pulse/releases/tag/v1.2.0
