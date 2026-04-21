<p align="center">
  <img src="assets/logo.svg" alt="Pulse" width="120"/>
</p>

<h1 align="center">Pulse</h1>

<p align="center">
  <strong>Keep your terminals alive.</strong><br/>
  A self-hosted dashboard for persistent tmux sessions — reconnect from any device without losing state.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/kevinzezel/pulse?color=blue"/></a>
  <a href="https://github.com/kevinzezel/pulse/releases"><img alt="Release" src="https://img.shields.io/github/v/release/kevinzezel/pulse?include_prereleases"/></a>
  <a href="https://github.com/kevinzezel/pulse/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/kevinzezel/pulse?style=social"/></a>
</p>

<p align="center">
  <img src="assets/demo.gif" alt="Demo — reconnecting mid-session" width="720"/>
</p>

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

> **Pin a version** — `PULSE_VERSION=v1.2.0 curl -fsSL …/install.sh | sh`
>
> **Client only** (for a remote server) — `PULSE_CLIENT_ONLY=1 curl -fsSL …/install.sh | sh`
>
> **All flags** — see [the installer source](install/install.sh).

## Why Pulse?

tmux on its own is powerful but has no UI. Tools like `ttyd` and `gotty` give you a web terminal but lose state on disconnect. Desktop apps like Tabby or iTerm are single-device. Pulse sits between all of these:

- Your **sessions live on the host**, multiplexed by real tmux — close the laptop, open your phone, keep working.
- Your **shells are the host's shells** — same aliases, same ssh keys, same `code` command. Pulse is not a container.
- One **dashboard, many servers**. Add a remote machine to `servers.json` and manage its terminals alongside your local ones.

## Features

- **Persistent tmux sessions.** Close the tab, restart the service, swap devices — sessions keep running.
- **Multi-server.** One dashboard, multiple remote Pulse clients (each on its own machine with its own API key).
- **Tiling mosaic UI** powered by `react-mosaic` — split, resize, and swap panes by drag-and-drop.
- **Notes and flows** live next to your terminals — quick sticky notes and visual flowcharts in the same workspace.
- **16 themes** (Tokyo Night, Dracula, Nord, Solarized, …) and **3 languages** (English, Português, Español).
- **Zero Docker.** Runs as a `systemd` or `launchd` user service — auto-starts on login, auto-restarts on crash.
- **One-line install** — no package manager required beyond the one you already have (`apt` / `brew`).

## How it works

```
┌──────────────┐           ┌─────────────────┐          ┌───────────────┐
│  Browser     │◄─────────►│  Pulse          │◄────────►│  Pulse Client │
│  (you)       │   HTTPS   │  Dashboard      │   WS +   │  (FastAPI)    │
│              │           │  (Next.js)      │   REST   │               │
└──────────────┘           └─────────────────┘          │   ▼           │
                                                        │   tmux        │
                                                        │   ▼           │
                                                        │   bash/zsh    │
                                                        └───────────────┘
                                                          host machine
```

- The **dashboard** (Next.js) is stateless — it talks to one or more **clients** (FastAPI + tmux).
- Each **client** runs on the machine whose terminals you want to manage. Sessions live in tmux; the client is a thin bridge between the browser WebSocket and the tmux pty.
- Restart the client? Sessions rebuild from `tmux list-sessions`. No state to lose.

## Self-hosting

After install, a few commands you'll want:

```sh
pulse status           # service health (client + dashboard)
pulse logs client -f   # follow client logs
pulse open             # launch browser at the dashboard
pulse keys show        # print the client's API_KEY
pulse upgrade          # fetch latest release and reinstall
pulse uninstall        # remove everything
```

Config files (all in `~/.config/pulse/`):

| File              | Required keys |
|-------------------|---|
| `client.env`      | `API_HOST`, `API_PORT`, `API_KEY` |
| `frontend.env`    | `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE` |
| `../local/share/pulse/frontend/data/servers.json` | list of Pulse clients the dashboard connects to |

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

Prerequisites: `tmux`, `python3 ≥ 3.10`, `node ≥ 18.17`. On Debian/Ubuntu or macOS, the start script installs them for you on first run.

```sh
git clone https://github.com/kevinzezel/pulse.git
cd pulse
./start.sh
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full dev setup, project layout, and conventions.

## Architecture

- **`client/`** — FastAPI app exposing REST + WebSocket. Spawns and multiplexes tmux sessions.
- **`frontend/`** — Next.js 15 (App Router) + React 19 + Tailwind 3 + xterm.js + react-mosaic. Single-password login with HS256 JWT.
- **`install/`** — the installer (`install.sh` / `install.ps1`), the `pulse` CLI umbrella, and systemd/launchd templates.
- **`.github/workflows/release.yml`** — packages a tarball on tag push and publishes a GitHub Release.

## License

[MIT](LICENSE) © 2026 Kevin Zezel Gomes

## Contributing

PRs welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first. For vulnerabilities, see [SECURITY.md](SECURITY.md).
