# Self-hosting Pulse

Operating Pulse on your own infrastructure: CLI, config files, reverse proxy, and networking defaults.

## Table of contents

1. [The `pulse` CLI](#the-pulse-cli)
2. [Config files](#config-files)
3. [Behind a reverse proxy](#behind-a-reverse-proxy)
4. [Networking defaults](#networking-defaults)

## The `pulse` CLI

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

## Config files

All in `~/.config/pulse/`:

| File              | Required keys |
|-------------------|---|
| `client.env`      | `API_HOST`, `API_PORT`, `API_KEY` |
| `frontend.env`    | `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE` |
| `../local/share/pulse/frontend/data/servers.json` | list of Pulse clients the dashboard connects to |
| `../local/share/pulse/frontend/data/storage-config.json` *(optional)* | when present, the dashboard reads/writes through the configured remote driver (MongoDB or S3) instead of local JSON files |

Prefer `pulse config password` / `pulse config ports` over editing the env files by hand — they keep `servers.json` in sync and restart the right services for you.

## Behind a reverse proxy

If you put Pulse behind NGINX / Caddy / Cloudflare with TLS:

1. Set `AUTH_COOKIE_SECURE=true` in `frontend.env`.
2. Proxy WebSocket traffic (`/ws/*` on the client, the full dashboard URL on the frontend).
3. Strip the `x-middleware-subrequest` header at the proxy (defense against future CVE-2025-29927 variants).

## Networking defaults

Pulse binds the client and the dashboard to the safest address the platform allows:

| Environment              | Default `API_HOST` / `WEB_HOST` | Why |
|--------------------------|---------------------------------|-----|
| Linux (native) / macOS   | `127.0.0.1`                     | Loopback only — other machines on your LAN can't reach it. |
| Windows (WSL2)           | `0.0.0.0`                       | Services run inside the WSL2 VM, which has its own network namespace. The Windows browser reaches them through WSL2's *localhost forwarding*, and **that feature only reflects `0.0.0.0` bindings** — `127.0.0.1` inside WSL is invisible to Windows. |

Under WSL2, `0.0.0.0` does **not** automatically publish the service on your LAN — by default Hyper-V's NAT keeps traffic inside the WSL VM, and only the Windows host reaches it via `localhost`. The API key on the client and the password + JWT on the dashboard still gate access.

**To open access for other devices on your LAN** (phone, another laptop), flip both binds to `0.0.0.0` explicitly:

```sh
pulse config host --client 0.0.0.0 --dashboard 0.0.0.0
```

This works on every platform: on Linux/Mac it starts exposing the ports on the LAN; on WSL2 it keeps exposure as is (already `0.0.0.0`) but makes the intent explicit. `pulse config host` auto-restarts the affected services and warns if you're exposing over plain HTTP — consider putting it behind a reverse proxy with TLS (see above) if the LAN isn't trusted.

To revert to loopback-only:

```sh
pulse config host --client 127.0.0.1 --dashboard 127.0.0.1   # Linux/Mac only
```

On WSL2, reverting the client to `127.0.0.1` will make the Windows browser fail to reach it — keep it on `0.0.0.0`.
