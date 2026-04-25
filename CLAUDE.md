# Pulse

Web dashboard that multiplexes terminals (PTYs) on the host. *Keep your terminals alive* — PTYs stay alive while the client is running; the WebSocket client connects/reconnects without losing screen state.

## Architecture

- **frontend**: Next.js 15 (App Router) + React 19 + Tailwind 3 + xterm.js + react-mosaic
- **client** (formerly "backend"): FastAPI (Python) + direct PTY (`pty.openpty` + `subprocess.Popen`) + WebSockets. The agent that runs wherever there are terminals to manage — locally or on a remote server.
- **Direct PTY**: each session is a shell spawned in its own PTY. Survives WS disconnect (frontend can reconnect). Dies on a client restart — the frontend keeps a client-side snapshot of the metadata (`getSessionsSnapshot`/`restoreSessions`) and fires `/sessions/restore` automatically on boot, recreating PTYs with the same name/group/project/cwd (shell history is lost).
- **pyte**: Python terminal emulator; the notification watcher uses it to render the canonical visual state of the PTY (no ANSI/cursor) and detect idle. Not in the WS hot path.

## Layout

```
pulse/
├── client/src/
│   ├── service.py              # FastAPI app + AppException handler + startup tasks
│   ├── routes/terminal.py      # HTTP + WS endpoints
│   ├── resources/terminal.py   # session logic + websocket_terminal() + reap_dead_ptys()
│   ├── resources/notifications.py  # idle watcher (pyte render + 5 rules)
│   ├── tools/pty.py            # PTYSession + registry (replaces the old tools/tmux.py)
│   └── system/
│       ├── log.py              # AppException(key, params, status_code)
│       └── i18n.py             # pt-BR/en/es catalog + build_i18n_response()
└── frontend/src/
    ├── app/
    │   ├── layout.js           # anti-FOUC script (theme+locale)
    │   ├── InnerLayout.js      # ThemeProvider + I18nProvider + Toaster
    │   └── page.js             # Main dashboard
    ├── components/             # Header, Sidebar, TerminalMosaic, TerminalPane, ...
    ├── providers/              # ThemeProvider, I18nProvider (useTranslation, useErrorToast)
    ├── themes/
    │   ├── themes.js           # registry of the 16 themes (id/label/base)
    │   ├── terminal.css        # HSL CSS vars (:root + .dark + .theme-<id>)
    │   └── xterm.js            # xterm palettes per theme
    ├── i18n/locales/           # pt-BR.json, en.json, es.json
    ├── services/api.js         # injects Accept-Language, propagates detail_key
    └── utils/mosaicHelpers.js  # react-mosaic tree manipulation
```

## Color system (themes)

**Never use a hardcoded hex color in JSX.** Always a token.

Tokens defined in `frontend/src/themes/terminal.css`:
- `:root` = default light theme
- `.dark` = default dark theme (set on `<html>` by default)
- `.theme-<id>` = overrides tokens for custom themes (Dracula, Nord, Tokyo Night, etc.)

Available tokens (each one is `H S% L%` without the `hsl()` wrapper, consumed via `hsl(var(--x))`):
- shadcn base: `background`, `foreground`, `card[-foreground]`, `primary[-foreground]`, `muted[-foreground]`, `accent[-foreground]`, `destructive[-foreground]`, `border`, `input`, `ring`
- App: `terminal`, `terminal-header`, `terminal-border`, `sidebar-bg`, `sidebar-border`
- Semantic: `success` (instead of `text-green-400`), `overlay` (instead of `bg-black/60`)
- Gradient: `bg-brand-gradient` (custom class = `linear-gradient(to right, hsl(var(--brand-gradient-from)), hsl(var(--brand-gradient-to)))`)

Preferred consumption: Tailwind classes (`bg-primary`, `text-muted-foreground`, `bg-terminal`, `bg-sidebar`, `text-success`, `bg-overlay/60`). When a token isn't exposed in Tailwind, use inline: `style={{ background: 'hsl(var(--x))' }}`.

### xterm.js

Terminals have their own palette — 16 objects in `frontend/src/themes/xterm.js` (one per theme). `TerminalPane` applies it through `terminal.options.theme` on creation and uses `applyXtermThemeToAll(theme)` in an effect when the theme changes.

### Adding a new theme

Three mechanical steps:
1. `.theme-<id> { --primary: ...; --background: ...; ... }` block in `terminal.css` (copy the structure from another theme; ~20 vars)
2. Entry `'<id>': { background, foreground, cursor, selectionBackground, black, red, green, yellow, blue, magenta, cyan, white, brightBlack, ... }` in `XTERM_THEMES` in `xterm.js`
3. Item `{ id, label, base: 'dark' | 'light' }` in `THEMES` in `themes.js`

`ThemeSelector` discovers it automatically.

### Persistence

Theme in `localStorage.rt:theme`. Inline script in `app/layout.js` (server-side → inline string in `<head>`) reads and applies the class before hydration to avoid FOUC. The list of IDs is injected at build time via `JSON.stringify(DARK_IDS)` / `LIGHT_IDS`.

## i18n system

3 languages: **en (default), pt-BR, es**. Custom solution, no external library. (International project — strings facing the public are written in English.)

### Frontend

Nested keys in `frontend/src/i18n/locales/{pt-BR,en,es}.json` (e.g. `sidebar.newTerminal`, `modal.confirmKill.message`).

Single hook:
```js
import { useTranslation, useErrorToast } from '@/providers/I18nProvider';

const { t, locale, setLocale, formatTime, formatDate } = useTranslation();
t('sidebar.newTerminal')                              // simple
t('modal.confirmKill.message', { id: 'term-1' })      // with {id} interpolation
formatTime(new Date())                                // Intl.DateTimeFormat with active locale

const showError = useErrorToast();
try { ... } catch (err) { showError(err); }           // already translates via detail_key
```

Persistence: `localStorage.rt:locale`. Initial default: `navigator.language` with fallback to en. The `<html lang>` is updated at runtime by the provider.

Extra export: `getCurrentLocale()` (module-level var) — used in `services/api.js` to inject `Accept-Language` on every fetch without needing a hook.

### Client (backend)

Mirrored catalog in `client/src/system/i18n.py` with `translate(key, locale, **params)` and `parse_accept_language(header)`.

Errors always via `AppException`:
```python
raise AppException(key="errors.session_not_found", status_code=404)
raise AppException(key="errors.session_not_found", status_code=404, extra="something")
```

Success via `build_i18n_response`:
```python
return build_i18n_response(request, 200, {
    "detail_key": "success.session_created",
    "session": {...}
})
```

The central handler reads `Accept-Language`, resolves it, and returns `{detail, detail_key, detail_params}`. The frontend prefers `detail_key` when present.

### Adding a key

1. New key in the 3 frontend JSONs (keep the nested structure).
2. If the message originates on the client: add the **same key** to `i18n.py` (flat dict).
3. In code: `t('key')` on the front, `AppException(key='key')` or `detail_key` on the client.

### ATTENTION — WebSocket close reasons

The strings `"Session ended"`, `"Replaced by new connection"`, `"Session not found"` in `resources/terminal.py` are a **contract** between front and client, not UI. Stay in English. The frontend (`TerminalPane.jsx`) string-matches them exactly and only then fires the localized toast. Do not translate on the client.

## Code conventions

- Never hardcoded hex/rgba in new JSX/CSS — always a token (or create a new token if justified)
- Never hardcoded UI strings — always `t('key')`
- API errors: `raise AppException(key=..., status_code=...)`, never inline `JSONResponse(status_code=X, content={"detail": "..."})`
- `localStorage` keys: always prefix with `rt:` (e.g. `rt:theme`, `rt:locale`, `rt:mosaicLayout`, `rt:sidebarOpen`)
- Python dict access: `d["key"]` when the key is mandatory, `d.get("key", default)` only with a real default
- Environment variables: `os.environ["VAR"]` for required vars, `os.environ.get("VAR", default)` only with a real default
- No emojis in code unless explicitly requested

## Critical areas

- **`frontend/src/components/TerminalPane.jsx`** — `terminalCache` is a module-level Map (outside React) to preserve xterm + WebSocket instances when react-mosaic re-mounts components. Use `destroyTerminal(id)` or `destroyAllTerminals()` (full reconnect).
- **`frontend/src/app/page.js`** — `reconnectKey` in `<TerminalMosaic key={reconnectKey}>` forces a remount of the whole tree; used by the "Wifi" button in the sidebar when the phone steals the connection. Auto-restore of sessions via `getSessionsSnapshot` + `restoreSessions` in the boot useEffect.
- **`client/src/resources/terminal.py`** — `sessions` dict (metadata) and `_active_ws` (1 WS per session) are in-memory. `recover_sessions()` is a no-op in PTY mode (no server-side persistence). The actual PTYs live in the `tools/pty.py` registry (`_pty_by_session`).
- **`client/src/tools/pty.py`** — `PTYSession` encapsulates process + master_fd + scrollback (bytearray, 512 KB with head trim). Registry is separate from the metadata dict to avoid non-serializable objects in JSON.
- **`reap_dead_ptys()` task** — runs every 30s on startup; detects shells that died with a closed WS, propagates close 1000, and clears registry + dict. Without it, orphan PTYs stick around in both.
- **`_active_ws[session_id]`** — only one WS per session. A new connection closes the old one with code 4000 `"Replaced by new connection"`.

## How to run

Orchestrator (boots both):
```
./start.sh
```

Client only:
```
./client/start.sh [--reload]
```

Frontend only:
```
./frontend/start.sh [--dev | --prod]
```

### Required envs

No fallback — if an env is missing, the scripts abort with a clear message. The `start.sh` scripts copy `.env.example` → `.env` on first run.

- `client/.env` (gitignored): `COMPOSE_PROJECT_NAME`, `VERSION`, `API_HOST`, `API_PORT`, `API_KEY` + optional TLS (`TLS_ENABLED`, `TLS_CERT_PATH`, `TLS_KEY_PATH` — default `false`/empty, managed via `pulse config tls`)
- `frontend/.env` (gitignored): `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE` + optional TLS (same trio above)

The frontend's server config still lives in `frontend/data/servers.json` (managed by Settings → Servers), not in env.

### Frontend authentication

Single-password gate + JWT HS256 24h in an httpOnly cookie `rt:auth`. `AUTH_PASSWORD` is the shared password; `AUTH_JWT_SECRET` is auto-generated by `start.sh` if it's `change-me` or missing. `/login` and `/api/auth/*` are the only public routes — `src/middleware.js` protects everything else (UI + API). Each API route handling sensitive data (`/api/servers|groups|prompts`) is also wrapped by `withAuth()` from `@/lib/auth` (defense-in-depth / DAL).

In production (behind NGINX/Cloudflare with TLS), keep `AUTH_COOKIE_SECURE=true`. In local dev without HTTPS, `AUTH_COOKIE_SECURE=false` — otherwise the browser drops the cookie. Also recommended to strip the `x-middleware-subrequest` header at the proxy (defense against future variants of CVE-2025-29927).

### Self-signed HTTPS (optional)

To use the dashboard on another device on your network without losing secure context (browser notifications, clipboard API, PWA service workers — all require HTTPS unless on localhost): `pulse config tls on` generates a self-signed cert at `$CONFIG_ROOT/tls/{cert,key}.pem` via `openssl` (RSA 2048, 825-day validity, SAN covering `localhost`/`127.0.0.1`/`::1`/`$(hostname)`), sets `TLS_ENABLED=true` in both `.env` files, and in parallel flips `AUTH_COOKIE_SECURE=true` in the dashboard. Services restart automatically. `pulse config tls off` reverts. Flags `--client` / `--dashboard` allow partial activation. `pulse config tls show` lists cert info + per-service state; `pulse config tls regen` forces regeneration (invalidates browser-accepted exceptions).

The frontend uses a custom server (`frontend/server.js`) in production — `node server.js` branches HTTP/HTTPS based on `TLS_ENABLED` from env. `dev` mode (`npx next dev`) **does not** support TLS (HMR conflicts with HTTPS wrap); use `--prod` if you want to test locally. The client uses `uvicorn --ssl-keyfile/--ssl-certfile` when `TLS_ENABLED=true`.

**Watch out for remote servers**: a dashboard on HTTPS blocks `ws://` / `http://` cross-origin (mixed content). Servers registered in Settings → Servers pointing to other hosts on HTTP need to be converted to HTTPS individually (SSH into the remote machine, run `pulse config tls on` there, update the protocol in Settings). The CLI **warns** but does not change the JSON automatically.

## Pre-commit verification

- `cd frontend && npm run build` — type-check + compile
- `cd client/src && python3 -c "import service"` — import smoke test
- Manual test: switch theme + language in the Header, create a session, reconnect from another tab (exercises the 4000 close code path)

## Release flow — instruction for Claude

Whenever you finish changes visible to the end user (features, bug fixes, new CLI commands, UI changes, installer tweaks, anything worth a CHANGELOG entry), at the end of the response **return a block with the git commands to publish the release**, even if the user didn't ask. Exceptions: purely internal changes (comments, silent refactor, typing) — only mention them briefly and **do not** propose a release.

The block must contain, in this order:

1. **Suggested version bump** following SemVer:
   - **patch** (`X.Y.Z+1`) — only bug fixes, no observable behavior change beyond the fix
   - **minor** (`X.Y+1.0`) — new features, new CLI commands, non-breaking UI changes, API expansions
   - **major** (`X+1.0.0`) — breaking changes (renamed command, removed flag, env/config schema change, incompatible API change)
2. **`CHANGELOG.md` update** done by you (Claude) before closing the task — new section at the top (`## [X.Y.Z] — YYYY-MM-DD`) with appropriate `### Added` / `### Changed` / `### Fixed` / `### Removed`, descriptive bullets per change, and updated footer links. If you haven't done this yet, do it before returning the block. **Always write CHANGELOG entries in English.**
3. **Ready-to-run shell script in `/tmp/`** — instead of returning a block of commands to copy/paste, **generate an executable file** via the Write tool at `/tmp/pulse-release-v<X.Y.Z>.sh` (release) or `/tmp/pulse-commit-<slug>.sh` (docs-only / commit without tag), with implicit exec permission (the user runs `bash /tmp/...sh`). Default release content:

   ```sh
   #!/usr/bin/env bash
   set -eu
   cd /media/kzezel/data/dados/development/aws/projetos/open_source/pulse
   git status
   git add <specific paths>     # never `git add -A`
   git commit -m "<type>(<scope>): <summary>"
   git tag -a v<X.Y.Z> -m "Pulse v<X.Y.Z> — <summary>"
   git push origin main
   git push origin v<X.Y.Z>     # triggers .github/workflows/release.yml
   echo "done — monitor with: gh run list --workflow=release.yml --limit 3"
   ```

   For commits without a tag (docs-only, chores), omit the `git tag` and the second `git push`. Do not include `git diff` — the user reviews it in their own editor/IDE if they want.

4. **Final message** mentioning the script path (e.g. "Run: `bash /tmp/pulse-release-v1.3.3.sh`") and what the script will do, in one line.

Rules:

- **Never run the git commands.** The repo owner asked that Git stays manual (see global CLAUDE.md). Just return the block.
- **Real date**: use the current date in `YYYY-MM-DD` format in the CHANGELOG entry.
- **Commit message**: follow the `type(scope): summary` style (e.g. `fix(client): reap zombie processes on PTYSession.close`, `feat(cli): add pulse config password/ports/paths/open`). Summary in English, consistent with prior commits in the repo.
- **Group related changes** into the same release. If the user asked for several things in sequence and none have been shipped yet, a single release bumping to the strongest type (fix+feature = minor, feature+breaking = major).
- **Do not suggest a patch release** if the change added a CLI command, an env var entry, or anything a user might come to depend on. Patches are for fixes only.
- If you're unsure about the bump type, **ask** before closing — but that's the exception, not the default.
- **All public-facing docs (README, CHANGELOG, NOTIFICATIONS, CONTRIBUTING, docs/) must be in English.** Internal-only files (gitignored, like `docs/superpowers/`) can be in any language.
