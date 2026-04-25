# Contributing to Pulse

Thanks for your interest in contributing. Pulse is a small, focused project and PRs are welcome.

## Quick links

- Bug reports, feature requests: [open an issue](https://github.com/kevinzezel/pulse/issues/new/choose)
- Questions: [GitHub Discussions](https://github.com/kevinzezel/pulse/discussions)
- Security issues: see [SECURITY.md](./SECURITY.md) — don't open public issues for vulns

## Development setup

Pulse has two services that run together in dev:

- **client** (Python / FastAPI) — spawns and manages PTY sessions on the host
- **frontend** (Next.js) — web dashboard

You need `python3` (3.10+), `node` (18.17+) and `uv` (Astral's Python package manager — the start script installs it for you on first run on Debian/Ubuntu/macOS).

```bash
git clone https://github.com/kevinzezel/pulse.git
cd pulse
./start.sh                 # runs both services, auto-installs deps
```

That boots the client at `http://localhost:8000` and the frontend at `http://localhost:3000`. The script prints a banner with the dev API key — register it in the frontend (Settings → Servers) before creating sessions.

To run one service at a time:

```bash
./client/start.sh --reload                    # hot-reload client
./frontend/start.sh --dev                     # next dev
./frontend/start.sh --prod                    # next build + start
```

## Project layout

```
pulse/
├── client/              # FastAPI backend — the terminal agent (was "backend")
│   └── src/
│       ├── service.py           # FastAPI app + startup tasks
│       ├── routes/              # HTTP + WS endpoints
│       ├── resources/           # session logic, websocket_terminal, idle watcher
│       ├── tools/pty.py         # PTYSession + registry (pty.openpty + subprocess)
│       └── system/              # i18n, auth, logging
├── frontend/            # Next.js dashboard
│   └── src/
│       ├── app/                 # App Router routes
│       ├── components/
│       ├── providers/           # ThemeProvider, I18nProvider
│       ├── themes/              # 16 themes (CSS vars + xterm palettes)
│       └── i18n/locales/        # en / pt-BR / es
├── install/             # Distribution artifacts (install.sh, pulse CLI, systemd/launchd units)
└── .github/workflows/   # Release pipeline
```

## Conventions

- **No hex colors in JSX.** Always use a design token (see `frontend/src/themes/terminal.css`).
- **No hardcoded UI strings.** Always use `t('key')` with entries in all three locale files.
- **API errors** raise `AppException(key=..., status_code=...)` — never return `JSONResponse` with inline strings.
- **`localStorage` keys** always start with `rt:` (`rt:theme`, `rt:locale`, `rt:mosaicLayout`).
- **Python dict access**: use `d["key"]` when the key must exist; reserve `d.get("key", default)` for genuinely optional keys with a sensible default.
- **Env vars**: `os.environ["VAR"]` for required vars (fail fast); `os.environ.get("VAR", default)` only with a real default.
- **No emojis in code** unless explicitly asked.

## Internationalization

The frontend ships with three locales (en, pt-BR, es). Whenever you add user-facing text:

1. Add the key to all three files in `frontend/src/i18n/locales/`.
2. If the string originates in the client (backend), add the same key to `client/src/system/i18n.py`.
3. Use `t('key')` in the frontend and `AppException(key='key')` / `detail_key` in the client.

English is the canonical source — write English first, then translate.

## Commit + PR

- **Branch from `main`.** Use descriptive branch names (`feat/xxx`, `fix/yyy`, `docs/zzz`).
- **Commit messages**: short imperative summary on line 1, details in the body if needed.
- **One concern per PR.** Unrelated refactors should be separate PRs.
- **Run the smoke checks** before pushing:
  - `cd frontend && npm run build` — type-check + compile
  - `cd client/src && python3 -c "import service"` — import smoke test
  - Manual: toggle theme + language, create a session, reconnect from another tab (exercises the 4000 close code path).

## Architecture notes

Each session is a shell spawned in its own PTY (`pty.openpty()` + `subprocess.Popen` with `os.setsid`), wrapped by `PTYSession` in `client/src/tools/pty.py`. The PTY owns the master fd plus a bounded scrollback buffer (512 KB, trimmed at boundaries) for byte-perfect replay when a WebSocket reconnects. Metadata lives only in memory in `resources/terminal.py:sessions` — a client restart kills the PTYs, but the dashboard's client-side snapshot (`getSessionsSnapshot` / `restoreSessions`) re-creates them automatically with the same name/group/project/cwd (shell history is lost).

A background task `reap_dead_ptys()` (in `client/src/service.py` startup) checks `is_alive()` every 30s and propagates close 1000 to any open WebSocket plus drops the registry entry — covers the case "shell exited via Ctrl-D while no one was attached".

The idle notification watcher (`resources/notifications.py`) uses [pyte](https://github.com/selectel/pyte) to render the PTY scrollback into a canonical text grid (no ANSI/cursor/colors) and MD5s the result. Five anti-spam rules; see [NOTIFICATIONS.md](./NOTIFICATIONS.md) for the full design.

WebSocket close reasons `"Session ended"`, `"Replaced by new connection"`, and `"Session not found"` are a front↔client contract and must stay in English. The frontend matches them by string to show a localized toast.

Only one WebSocket per session (`_active_ws[session_id]`). A new connection closes the old one with code 4000 and reason `"Replaced by new connection"`. The viewing-presence heartbeat (`{type:'viewing'}`) goes through a separate multi-client `/ws/notifications` channel so opening the same session on a phone doesn't drop the desktop's "I'm watching" signal.

## License

By contributing, you agree that your contributions are licensed under the MIT License (see [LICENSE](./LICENSE)).
