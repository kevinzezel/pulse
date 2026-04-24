# Self-hosting Pulse

Operating Pulse on your own infrastructure: CLI, config files, reverse proxy, and networking defaults.

## Table of contents

1. [The `pulse` CLI](#the-pulse-cli)
2. [Config files](#config-files)
3. [Behind a reverse proxy](#behind-a-reverse-proxy)
4. [HTTPS without a reverse proxy (self-signed)](#https-without-a-reverse-proxy-self-signed)
5. [Networking defaults](#networking-defaults)

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
pulse config tls show           # cert info + per-service TLS_ENABLED state
pulse config tls on --client --dashboard  # enable self-signed HTTPS (asks for confirmation)
pulse config tls off --dashboard          # disable on dashboard only
pulse config tls regen          # regenerate cert/key (invalidates browser exceptions)
pulse config rotate-jwt         # regenerate AUTH_JWT_SECRET (kicks every login)
pulse config paths              # print install / config / logs paths
pulse config open config        # open ~/.config/pulse in your file manager
pulse config edit client        # open client.env in $EDITOR
```

## Config files

All in `~/.config/pulse/`:

| File              | Required keys |
|-------------------|---|
| `client.env`      | `API_HOST`, `API_PORT`, `API_KEY` &nbsp;·&nbsp; *(optional)* `TLS_ENABLED`, `TLS_CERT_PATH`, `TLS_KEY_PATH` |
| `frontend.env`    | `WEB_HOST`, `WEB_PORT`, `AUTH_PASSWORD`, `AUTH_JWT_SECRET`, `AUTH_COOKIE_SECURE` &nbsp;·&nbsp; *(optional)* `TLS_ENABLED`, `TLS_CERT_PATH`, `TLS_KEY_PATH` |
| `tls/cert.pem` &nbsp;·&nbsp; `tls/key.pem` *(optional)* | created by `pulse config tls on` — RSA-2048 self-signed pair, 825-day validity |
| `../local/share/pulse/frontend/data/servers.json` | list of Pulse clients the dashboard connects to |
| `../local/share/pulse/frontend/data/storage-config.json` *(optional)* | when present, the dashboard reads/writes through the configured remote driver (MongoDB or S3) instead of local JSON files |

Prefer `pulse config password` / `pulse config ports` over editing the env files by hand — they keep `servers.json` in sync and restart the right services for you.

## Behind a reverse proxy

If you put Pulse behind NGINX / Caddy / Cloudflare with TLS:

1. Set `AUTH_COOKIE_SECURE=true` in `frontend.env`.
2. Proxy WebSocket traffic (`/ws/*` on the client, the full dashboard URL on the frontend).
3. Strip the `x-middleware-subrequest` header at the proxy (defense against future CVE-2025-29927 variants).

## HTTPS without a reverse proxy (self-signed)

If you don't have NGINX/Caddy in front of Pulse but still need HTTPS — for example because you want **browser notifications**, **clipboard API**, or **PWA install** to work from your **phone or another device on the LAN** (`http://192.168.x.y:3000` is not a secure context, only `localhost` is) — Pulse can serve a self-signed cert directly out of the dashboard and the client.

### Why you'd want this

The browser only treats `localhost` and HTTPS origins as **secure contexts**. Without one, `Notification.requestPermission()` returns `denied`, the clipboard API refuses to read, and service workers won't register. So as soon as you open `http://192.168.0.42:3000` from your phone the bell icon stops working — even though the dashboard renders fine.

A self-signed cert solves that. The trade-off: every device that opens the dashboard for the first time has to **manually accept the certificate** (one click on desktop browsers, a few extra taps on mobile Safari).

### Enable

```sh
pulse config tls on --client --dashboard
```

`--client` and `--dashboard` are **required** (you must say which side to flip — silently doing both was too easy a footgun). The command:

1. Generates an RSA-2048 self-signed cert in `~/.config/pulse/tls/{cert.pem,key.pem}` if not already there. SAN covers `localhost`, `127.0.0.1`, `::1`, and the machine's `hostname`. Validity 825 days (Apple's hard cap for self-signed).
2. Prints a preview of every change it will make (env files, services to restart, mixed-content warnings for any HTTP servers in `servers.json`).
3. Asks `Continue? [y/N]` — pass `-y` to skip in scripts.
4. On confirmation: writes `TLS_ENABLED=true` (plus `AUTH_COOKIE_SECURE=true` on the dashboard, required so the browser doesn't drop the cookie under HTTPS), restarts the affected services.

You'll then access the dashboard at `https://<host>:3000`. First visit shows a self-signed warning — accept once per browser/device.

### The mixed-content gotcha (remote clients)

If your dashboard is HTTPS but you have other Pulse clients on **other hosts** registered as `http://` in **Settings → Servers**, the browser will **block** the WebSocket and REST calls to them (mixed-content rule — non-negotiable). When you run `pulse config tls on --dashboard`, the CLI lists those remotes and warns explicitly. It does **not** rewrite `servers.json` automatically: doing so would just point the dashboard at `https://remote-host` while the remote `uvicorn` is still serving HTTP, and the TLS handshake would fail.

To convert each remote: SSH in, run `pulse config tls on --client --dashboard` there, then flip the entry's protocol to `https` in **Settings → Servers** on the dashboard.

### Disable, inspect, regenerate

```sh
pulse config tls off --dashboard         # back to plain HTTP on the dashboard only
pulse config tls show                    # cert path, expiry, CN, SAN, per-service state
pulse config tls regen                   # overwrite cert/key (every device must re-accept)
```

`regen` exists for two cases: the cert expired, or you moved the machine to a new hostname and the SAN no longer matches. It always asks for confirmation because every previously-trusted browser exception becomes invalid.

### Caveats

- **Modo `dev` do frontend (`./frontend/start.sh --dev`) ignora TLS** — Next dev's HMR conflicts with the custom HTTPS server. Use `./frontend/start.sh --prod` (or just the systemd-managed install) to test HTTPS locally.
- **Mobile Safari** is the strictest browser for self-signed certs — you may need to install the cert in iOS Settings → General → VPN & Device Management before the warning goes away. Chrome/Firefox/Safari on desktop just need one click on "Advanced → Proceed".
- **`openssl ≥ 1.1.1` is required** (for the `-addext` flag). Ubuntu 20.04+ and macOS Monterey+ ship with it.

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
