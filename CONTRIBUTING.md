# Contributing to Pulse

Thanks for your interest in contributing. Pulse is a small, focused project and PRs are welcome.

## Quick links

- Bug reports, feature requests: [open an issue](https://github.com/kevinzezel/pulse/issues/new/choose)
- Questions: [GitHub Discussions](https://github.com/kevinzezel/pulse/discussions)
- Security issues: see [SECURITY.md](./SECURITY.md) — don't open public issues for vulns

## Development setup

Pulse has two services that run together in dev:

- **client** (Python / FastAPI) — manages tmux sessions on the host
- **frontend** (Next.js) — web dashboard

You need `tmux`, `python3` (3.10+), `node` (18.17+) and `uv` (Astral's Python package manager — the start script installs it for you on first run on Debian/Ubuntu/macOS).

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
│       ├── service.py           # FastAPI app
│       ├── routes/              # HTTP + WS endpoints
│       ├── resources/           # session logic, websocket_terminal
│       ├── tools/tmux.py        # tmux CLI wrappers
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

Tmux sessions are the source of truth — Pulse's in-memory `sessions` dict in `resources/terminal.py` is rebuilt from `tmux list-sessions` at startup. This means the client process can be restarted without losing sessions.

WebSocket close reasons `"Session ended"`, `"Replaced by new connection"`, `"Session not found"`, and `"tmux session not found"` are a front↔client contract and must stay in English. The frontend matches them by string to show a localized toast.

Only one WebSocket per session (`_active_ws[session_id]`). A new connection closes the old one with code 4000 and reason `"Replaced by new connection"`.

## License

By contributing, you agree that your contributions are licensed under the MIT License (see [LICENSE](./LICENSE)).
