<p align="center">
  <img src="assets/logo.svg" alt="Pulse" width="120"/>
</p>

<h1 align="center">Pulse</h1>

<p align="center">
  <strong>Your AI coding cockpit.</strong><br/>
  Notifications, mobile control, and a shared workspace for every Claude Code / Cursor / Codex / Gemini session you run.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/kevinzezel/pulse?color=blue"/></a>
  <a href="https://github.com/kevinzezel/pulse/releases"><img alt="Release" src="https://img.shields.io/github/v/release/kevinzezel/pulse?include_prereleases"/></a>
  <a href="https://github.com/kevinzezel/pulse/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kevinzezel/pulse?style=social"/></a>
</p>

<p align="center">
  <sub>Tested with <strong>Claude Code</strong>, <strong>Cursor CLI</strong>, <strong>Codex CLI</strong>, <strong>Gemini CLI</strong> — works with any CLI that runs in a shell.</sub>
</p>

<!--
  TODO: record assets/demo.gif before the next release.
  Suggested 20–30s loop:
    1. Split into 4 panes, each running a different AI CLI.
    2. Trigger an action in pane 1, cut to phone mockup receiving the idle notification.
    3. Back to desktop: drag a sticky note, show saved prompts, flip to an Excalidraw flow.
    4. End on the dashboard tagline.
-->

You kick off Claude Code, wait three minutes, come back — it's been idle for two and a half, waiting on a Yes/No prompt. Leave the desk for a coffee and your phone buzzes: `frontend::refactor is idle — Approve edit to layout.js?`. You tap yes, it keeps going.

Pulse is a web dashboard for your tmux sessions. The AI CLIs keep running on your machine; you stay connected from any device.

## Install

**Linux / macOS:**

```sh
curl -fsSL https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.sh | sh
```

**Windows** (requires [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)):

```powershell
irm https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.ps1 | iex
```

Open `http://localhost:3000` when it finishes. That's it.

> **Pin a version** — `PULSE_VERSION=v1.3.2 curl -fsSL …/install.sh | sh`
>
> **Client only** (for a remote server) — `PULSE_CLIENT_ONLY=1 curl -fsSL …/install.sh | sh`
>
> **All flags** — see [the installer source](install/install.sh).

## Why Pulse?

- **vs. a local terminal.** Close the lid and the agent freezes waiting for your input. Pulse's tmux sessions outlive laptop sleep; the idle watcher pings your phone the moment the output stops moving.
- **vs. `tmux` + `ttyd`/`gotty`.** You get a terminal in a browser, but no project-scoped groups, no mobile keybar sized for AI approvals, no notifications, no per-pane "open in VSCode".
- **vs. Tabby / iTerm / Warp.** Single device, no remote-by-default, no shared workspace with notes and flow diagrams.

Pulse runs on your machine, speaks to real tmux, doesn't containerize anything, doesn't phone home.

## Features

### Don't miss an approval prompt

Every 5 seconds Pulse MD5s the tmux pane. Thirty seconds of no change after your last Enter = the AI is waiting on you. The threshold is tunable per deployment (5 seconds to 1 hour) and the toggle is per session — a bell in the sidebar flips it on, persisted as a tmux option so it survives restarts.

Notifications land in the **browser** (toast + sound + Web Notification API) while the dashboard is open, and on **Telegram** when it isn't — so the phone in your pocket tells you when the agent stops. The payload carries the last 20 lines of pane output, which is usually enough to decide yes/no without opening the dashboard.

<!-- TODO: add assets/screenshots/mobile-notification.png — phone receiving an idle toast with the MobileKeyBar visible. -->

### Work from anywhere, from any device

Fully responsive (rebuilt, not "friendly"). On mobile, `TerminalMosaic` switches to a tab-based layout because `react-mosaic` doesn't play well with touch. A keybar pinned to the bottom gives you `Esc · Tab · ← → ↑ ↓ · Enter · Ctrl+C` — the exact keys the major AI CLIs ask for during approvals.

Touch scroll inside the terminal works via synthesized VT200 mouse-wheel escapes, so Claude Code, `less`, and `vim` all scroll as if you had a wheel. The viewport is pinned (`interactiveWidget: resizes-content`) so the virtual keyboard pushes the page up instead of covering the terminal.

### Multi-project, multi-session organization

Two levels of grouping: **Projects** at the top (switchable from the header) and **Groups** inside each project. Assign any session to a group; open all sessions in a group with a single click; hide groups you don't want to see today. Drag-and-drop reorders them.

Mosaic layouts are saved per `project::group` pair — switch project, your split panes come back exactly where you left them. When you reopen the dashboard, sessions auto-restore and reconnect with backoff.

<!-- TODO: add assets/screenshots/mosaic-four-ais.png — split mosaic with four panes, each running a different AI CLI. -->

### Jump to code

`POST /api/sessions/{id}/open-editor` launches `code <cwd>` on the machine where the client runs. Pulse resolves the `code` binary across `apt`, `snap`, flatpak, and forces `DISPLAY=:0` so it works when the client runs under systemd without a login session.

For remote clients, the same button opens `vscode://vscode-remote/ssh-remote+<host><cwd>` — your local VSCode handles the URI and drops into the right directory via Remote-SSH. The "open in VSCode" action is available on every sidebar card, on every mosaic pane, and on group chips ("open all").

### Keep context alive

- **Sticky notes** — draggable, resizable, color-themed, pinned and minimizable. Stored per project. Auto-saved.
- **Saved prompts** — a searchable library of reusable prompts. One click copies to clipboard or sends straight to the active terminal, with or without Enter. Scope them globally or per project.
- **Flows** — Excalidraw embedded as a page. Multiple diagrams per project, auto-saved, themed alongside the rest of the dashboard.

<table>
  <tr>
    <td>
      <!-- TODO: add assets/screenshots/sticky-notes.png — dashboard with three floating sticky notes over a mosaic of terminals. -->
    </td>
    <td>
      <!-- TODO: add assets/screenshots/excalidraw-flow.png — Flows page showing an architecture diagram for a real project. -->
    </td>
  </tr>
</table>

### Paste images into AI CLIs

Paste a screenshot straight into the dashboard. Pulse drops the file on the host and types the path as `@/tmp/…` into the active pane — the Claude Code way to attach an image.

### Run Pulse anywhere you SSH

One dashboard, any number of clients. Each remote has its own color, health check, and API key. Session IDs are prefixed `srv-xxx::term-N` so you never lose track of which box a terminal lives on.

### Look the way you want

16 themes: Dracula, Nord, Tokyo Night, Catppuccin (Latte / Frappé / Macchiato / Mocha), Gruvbox (light + dark), Solarized (light + dark), One Dark, Monokai, GitHub Dark Dimmed, plus the default dark and light. 3 UI languages: English, Português (Brasil), Español — 518 keys each.

## How it works

```
┌──────────────┐           ┌─────────────────┐          ┌─────────────────────────┐
│  Browser     │◄─────────►│  Pulse          │◄────────►│  Pulse Client           │
│  (you)       │   HTTPS   │  Dashboard      │   WS +   │  (FastAPI)              │
│              │           │  (Next.js)      │   REST   │                         │
└──────────────┘           └─────────────────┘          │   ▼                     │
                                                        │   tmux                  │
                                                        │   ▼                     │
                                                        │   bash/zsh              │
                                                        │   + Claude Code /       │
                                                        │     Cursor CLI /        │
                                                        │     Codex / Gemini /    │
                                                        │     anything else       │
                                                        └─────────────────────────┘
                                                          host machine
```

- The **dashboard** (Next.js) is stateless — it talks to one or more **clients** (FastAPI + tmux).
- Each **client** runs on the machine whose terminals you want to manage. Sessions live in tmux; the client is a thin bridge between the browser WebSocket and the tmux pty.
- A **background watcher** in the client MD5s every session flagged for idle detection on a 5-second tick and pushes events through the same WebSocket the browser uses.
- Restart the client? Sessions rebuild from `tmux list-sessions`. Nothing to lose.

## Self-hosting

After install, a few commands you'll want. Run `pulse help` for the full list.

```sh
pulse status                    # service health (client + dashboard)
pulse logs client -f            # follow client logs
pulse open                      # launch browser at the dashboard
pulse upgrade                   # fetch latest release and reinstall
pulse uninstall                 # remove everything

pulse keys show                 # print the client's API_KEY
pulse keys regen                # rotate it (updates servers.json too)

pulse config password           # change the dashboard password
pulse config ports              # show current ports
pulse config ports --client 8000 --dashboard 4000   # change them (auto-restarts)
pulse config host               # show current bind hosts
pulse config host --dashboard 0.0.0.0               # expose on the LAN
pulse config secure on          # AUTH_COOKIE_SECURE=true (behind HTTPS)
pulse config rotate-jwt         # regenerate AUTH_JWT_SECRET (kicks every login)
pulse config paths              # print install / config / logs paths
pulse config open config        # open ~/.config/pulse in your file manager
pulse config edit client        # open client.env in $EDITOR
```

Config files (all in `~/.config/pulse/`):

| File              | Required keys |
|-------------------|---|
| `client.env`      | `API_HOST`, `API_PORT`, `API_KEY` |
| `frontend.env`    | `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE` |
| `../local/share/pulse/frontend/data/servers.json` | list of Pulse clients the dashboard connects to |

Prefer `pulse config password` / `pulse config ports` over editing the env files by hand — they keep `servers.json` in sync and restart the right services for you.

### Behind a reverse proxy

If you put Pulse behind NGINX / Caddy / Cloudflare with TLS:

1. Set `AUTH_COOKIE_SECURE=true` in `frontend.env`.
2. Proxy WebSocket traffic (`/ws/*` on the client, the full dashboard URL on the frontend).
3. Strip the `x-middleware-subrequest` header at the proxy (defense against future CVE-2025-29927 variants).

### Running the client on a remote server

On the server:

```sh
PULSE_CLIENT_ONLY=1 curl -fsSL https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.sh | sh
pulse keys show     # copy the API_KEY
```

In the dashboard: **Settings → Servers → Add**, paste the host + port + API key.

## Development

Prerequisites: `tmux`, `python3 ≥ 3.10`, `node ≥ 18.18`. On Debian/Ubuntu or macOS, the start script installs them for you on first run.

```sh
git clone https://github.com/kevinzezel/pulse.git
cd pulse
./start.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev setup, project layout, and conventions.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Acknowledgments

Pulse is built on top of a lot of great open-source work. A non-exhaustive list of the projects it leans on most:

- [tmux](https://github.com/tmux/tmux) (ISC) — the terminal multiplexer that makes sessions persistent.
- [xterm.js](https://github.com/xtermjs/xterm.js) (MIT) — the browser-side terminal emulator.
- [Excalidraw](https://github.com/excalidraw/excalidraw) (MIT) — the whiteboard that powers Flows.
- [react-mosaic](https://github.com/nomcopter/react-mosaic) (MIT) — the tiling window manager for the desktop layout.
- [react-rnd](https://github.com/bokuweb/react-rnd) (MIT) — draggable and resizable sticky notes.
- [FastAPI](https://github.com/tiangolo/fastapi) (MIT) — the HTTP + WebSocket server on the client side.
- [Next.js](https://github.com/vercel/next.js) (MIT) — the dashboard framework.
- [lucide-react](https://github.com/lucide-icons/lucide) (ISC) — icons.

Licenses for each dependency ship with it via `npm` / `pip` and travel with every install. Pulse does not redistribute these projects' source.

## License

[MIT](LICENSE) © 2026 Kevin Zezel Gomes.

Pulse embeds [Excalidraw](https://github.com/excalidraw/excalidraw/blob/master/LICENSE), [xterm.js](https://github.com/xtermjs/xterm.js/blob/master/LICENSE), [react-mosaic](https://github.com/nomcopter/react-mosaic/blob/master/LICENSE), and other components — all MIT or MIT-compatible. See [Acknowledgments](#acknowledgments).

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. For vulnerabilities, see [SECURITY.md](SECURITY.md).
