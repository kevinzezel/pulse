# Multi-server setup

Pulse is split by design into two pieces: the **dashboard** (the web UI you open in the browser) and the **client** (the agent that spawns and manages PTY sessions on a host). One dashboard can manage clients running on many machines — your local workstation, a VPS, a LAN box, a Docker host — each appearing as a separate entry in the sidebar, selectable with one click.

## Table of contents

1. [Install only the client on a remote server](#install-only-the-client-on-a-remote-server)
2. [Install only the dashboard](#install-only-the-dashboard)
3. [Register a client in the dashboard](#register-a-client-in-the-dashboard)
4. [Opening files in your local editor](#opening-files-in-your-local-editor)
5. [Typical architectures](#typical-architectures)

## Install only the client on a remote server

On the remote machine:

```sh
PULSE_CLIENT_ONLY=1 curl -fsSL https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.sh | sh
pulse keys show    # copy the API_KEY printed
```

`PULSE_CLIENT_ONLY=1` skips the dashboard install and its Node.js dep — the box only needs `python3 ≥ 3.10` and `uv` (auto-installed by the script). The client runs under a systemd user unit (Linux) or a launchd agent (macOS) and auto-restarts on failure.

If the remote is behind NAT and you want to reach it from a dashboard running elsewhere:

1. Open port `8000` (or whatever you passed as `PULSE_CLIENT_PORT`) on the server's firewall / cloud provider security group.
2. `pulse config host --client 0.0.0.0` on the remote — makes the client listen on all interfaces instead of loopback only.
3. If the link isn't trusted (public internet), put NGINX / Caddy / Cloudflare + TLS in front — see [`SELF-HOSTING.md`](SELF-HOSTING.md#behind-a-reverse-proxy). The API key is the primary gate, but HTTPS is still worth adding.

## Install only the dashboard

Flip the flag:

```sh
PULSE_DASHBOARD_ONLY=1 curl -fsSL https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.sh | sh
```

Useful when you want the dashboard on your laptop but every client on remote machines. `servers.json` is seeded empty; you add hosts via the UI.

## Register a client in the dashboard

In the dashboard: **Settings → Servers → Add**. Fill in:

| Field      | Value |
|------------|-------|
| Name       | Anything (e.g. `vps-prod`, `macbook`, `home-lab`). |
| Protocol   | `http` for plain, `https` if fronted by TLS. |
| Host       | IP or hostname **as the browser sees it**. If both dashboard and client live on the same box: `127.0.0.1`. For a remote: the public IP or DNS name. |
| Port       | Matches `API_PORT` on the remote client. |
| API Key    | From `pulse keys show` on the remote. |

Save. The dashboard probes the new client and it appears in the sidebar. Repeat for every machine. Click between entries to switch which host you're driving — each shows its own PTY sessions independently.

From the same dashboard you can also:

- **Edit** a server (rename, change port, rotate its API key).
- **Delete** a server.
- **Reorder** by drag. The order persists in `servers.json` on the dashboard machine.

## Opening files in your local editor

The "open editor" button (sidebar card, mosaic pane toolbar, group chip) behaves differently depending on whether the client is local or remote:

- **Local client** (browser and client on the same machine): Pulse calls `POST /api/sessions/{id}/open-editor` on the client, which spawns `code <cwd>` directly on that machine. The button shows a folder icon.
- **Remote client**: Pulse generates a `vscode://vscode-remote/ssh-remote+<host>/<cwd>` URL and asks your browser to open it. Your **local** VS Code handles the URI through the Remote-SSH extension and drops into that directory on the remote. The button shows an external-link icon.

### SSH alias for remote (custom keys / users / ports)

By default the URL uses `server.host` as the SSH target — works fine if your `~/.ssh/config` resolves that hostname with default settings. If you SSH into the server with a custom IdentityFile, User, or Port (anything you'd normally pass via `ssh -i key user@host -p N`), VS Code Remote-SSH won't pick those up from the URL — it needs to find a `Host` block in `~/.ssh/config` matching the target.

Solution: add an alias to your `~/.ssh/config` and tell Pulse to use it.

```sshconfig
Host my-prod
  HostName 10.0.0.50
  User ubuntu
  IdentityFile ~/.ssh/prod_key
  Port 2222
```

Then in **Settings → Servers → edit the server → SSH alias** fill in `my-prod`. The button now generates `vscode://vscode-remote/ssh-remote+my-prod/<cwd>` and Remote-SSH applies the alias settings (User, IdentityFile, Port).

### Group "open all" on a remote — VS Code single-instance gotcha

Clicking the editor icon on a group chip with N remote sessions fires N URL handlers staggered 1.5s apart. By default VS Code **aggregates** multiple folder-open requests into the **same window**, each new one replacing the previous folder — so you'd see only the last folder, not N windows.

Workaround: in your **local** VS Code, set `"window.openFoldersInNewWindow": "on"`:

1. `Cmd/Ctrl + ,` (open Settings).
2. Search for `openFoldersInNewWindow`.
3. Switch from `default` to `on`.

After that, each remote URL Pulse fires spawns its own VS Code window.

This is a VS Code default behavior, not a Pulse limitation — there is no public query parameter for the `vscode-remote://` URL scheme to force a new window from the URL itself. The local "open all" doesn't have this issue because Pulse spawns `code -n <path>` directly on the client (the `-n` flag forces a new window for `code` family editors: VS Code, Cursor, VSCodium, Windsurf, code-insiders).

## Typical architectures

```
[ laptop / PC — browser ]
          │
          ▼
[ dashboard (Next.js)  ]  ──►  [ client #1 ] localhost:8000 (same box)
                           ──►  [ client #2 ] 10.0.0.50:8000 (LAN VPS)
                           ──►  [ client #3 ] api.example.com (public, HTTPS)
```

Dashboard holds `servers.json` (its own config — not shared). Each client is independent, owns its own PTY sessions, has its own API key, and survives dashboard restarts.
