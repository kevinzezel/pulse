#!/bin/sh
# Pulse CLI — umbrella for managing the Pulse client and dashboard services.
#
# Placed at ~/.local/bin/pulse by the installer. Dispatches to
# systemctl --user (Linux/WSL) or launchctl (macOS).
set -eu

REPO_OWNER="kevinzezel"
REPO_NAME="pulse"
GITHUB_REPO="${REPO_OWNER}/${REPO_NAME}"

INSTALL_ROOT="$HOME/.local/share/pulse"
CONFIG_ROOT="$HOME/.config/pulse"
STATE_ROOT="$HOME/.local/state/pulse"

# -----------------------------------------------------------------------------
# Colors
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
    # Use real ESC bytes (not literal backslash-escape strings) so heredocs
    # and `echo` render them as ANSI codes without needing `printf %b`.
    ESC="$(printf '\033')"
    YELLOW="${ESC}[1;33m"; GREEN="${ESC}[1;32m"; RED="${ESC}[1;31m"
    BLUE="${ESC}[1;34m"; BOLD="${ESC}[1m"; DIM="${ESC}[2m"; NC="${ESC}[0m"
else
    YELLOW=''; GREEN=''; RED=''; BLUE=''; BOLD=''; DIM=''; NC=''
fi

log()  { printf "%b[pulse]%b %s\n" "$GREEN"  "$NC" "$*"; }
warn() { printf "%b[pulse]%b %s\n" "$YELLOW" "$NC" "$*" 1>&2; }
err()  { printf "%b[pulse]%b %s\n" "$RED"    "$NC" "$*" 1>&2; }
die()  { err "$*"; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# -----------------------------------------------------------------------------
# Platform
# -----------------------------------------------------------------------------
detect_os() {
    case "$(uname -s)" in
        Linux)  PULSE_OS=linux ;;
        Darwin) PULSE_OS=macos ;;
        *) die "unsupported OS: $(uname -s)" ;;
    esac
}

# Map "client"/"dashboard"/"all" to the unit list per platform.
resolve_units() {
    target="${1:-all}"
    case "$PULSE_OS" in
        linux)
            case "$target" in
                client)    UNITS="pulse-client.service" ;;
                dashboard) UNITS="pulse.service" ;;
                all|"")    UNITS="pulse-client.service pulse.service" ;;
                *) die "unknown target '$target' (use: client, dashboard, all)" ;;
            esac
            ;;
        macos)
            case "$target" in
                client)    UNITS="sh.pulse.client" ;;
                dashboard) UNITS="sh.pulse.dashboard" ;;
                all|"")    UNITS="sh.pulse.client sh.pulse.dashboard" ;;
                *) die "unknown target '$target' (use: client, dashboard, all)" ;;
            esac
            ;;
    esac
}

# -----------------------------------------------------------------------------
# Subcommands
# -----------------------------------------------------------------------------
cmd_status() {
    case "$PULSE_OS" in
        linux)
            printf "%bclient:%b\n"    "$BOLD" "$NC"; systemctl --user status pulse-client.service --no-pager -l 2>/dev/null | head -5 || echo "  (not installed)"
            printf "\n%bdashboard:%b\n" "$BOLD" "$NC"; systemctl --user status pulse.service        --no-pager -l 2>/dev/null | head -5 || echo "  (not installed)"
            ;;
        macos)
            printf "%bclient:%b    "    "$BOLD" "$NC"; launchctl list | awk '$3=="sh.pulse.client"    { print "PID="$1" status="$2; found=1 } END { if (!found) print "(not loaded)" }'
            printf "%bdashboard:%b "    "$BOLD" "$NC"; launchctl list | awk '$3=="sh.pulse.dashboard" { print "PID="$1" status="$2; found=1 } END { if (!found) print "(not loaded)" }'
            ;;
    esac
}

cmd_start() {
    resolve_units "${1:-all}"
    case "$PULSE_OS" in
        linux)
            # shellcheck disable=SC2086
            systemctl --user start $UNITS
            ;;
        macos)
            for u in $UNITS; do
                plist="$HOME/Library/LaunchAgents/$u.plist"
                [ -f "$plist" ] && launchctl load -w "$plist" 2>/dev/null || true
            done
            ;;
    esac
    log "started: $UNITS"
}

cmd_stop() {
    resolve_units "${1:-all}"
    case "$PULSE_OS" in
        linux)
            # shellcheck disable=SC2086
            systemctl --user stop $UNITS
            ;;
        macos)
            for u in $UNITS; do
                plist="$HOME/Library/LaunchAgents/$u.plist"
                [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null || true
            done
            ;;
    esac
    log "stopped: $UNITS"
}

cmd_restart() {
    resolve_units "${1:-all}"
    case "$PULSE_OS" in
        linux)
            # shellcheck disable=SC2086
            systemctl --user restart $UNITS
            ;;
        macos)
            cmd_stop "${1:-all}"
            sleep 1
            cmd_start "${1:-all}"
            ;;
    esac
    log "restarted: $UNITS"
}

cmd_logs() {
    follow=""
    target=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            -f|--follow)          follow="1"; shift ;;
            client|dashboard|all) target="$1"; shift ;;
            *) die "unknown arg: $1 (use: [client|dashboard|all] [-f])" ;;
        esac
    done
    target="${target:-all}"
    case "$PULSE_OS" in
        linux)
            # journalctl natively merges multiple -u flags by timestamp.
            case "$target" in
                client)    units="-u pulse-client.service" ;;
                dashboard) units="-u pulse.service" ;;
                all)       units="-u pulse-client.service -u pulse.service" ;;
            esac
            if [ -n "$follow" ]; then
                # shellcheck disable=SC2086
                journalctl --user $units -f
            else
                # shellcheck disable=SC2086
                journalctl --user $units --no-pager -n 100
            fi
            ;;
        macos)
            case "$target" in
                client)    files="$STATE_ROOT/logs/client.log" ;;
                dashboard) files="$STATE_ROOT/logs/dashboard.log" ;;
                all)       files="$STATE_ROOT/logs/client.log $STATE_ROOT/logs/dashboard.log" ;;
            esac
            # shellcheck disable=SC2086
            for f in $files; do [ -f "$f" ] || die "log file not found: $f"; done
            if [ -n "$follow" ]; then
                # shellcheck disable=SC2086
                tail -F $files
            else
                # shellcheck disable=SC2086
                tail -n 100 $files
            fi
            ;;
    esac
}

cmd_open() {
    env_file="$CONFIG_ROOT/frontend.env"
    [ -f "$env_file" ] || die "dashboard not installed (no frontend.env)"
    port="$(grep -E '^WEB_PORT=' "$env_file" | cut -d= -f2-)"
    host="$(grep -E '^WEB_HOST=' "$env_file" | cut -d= -f2-)"
    # Bind-any hosts answer on localhost too — prefer the friendly name.
    # A concrete LAN IP (e.g. 192.168.1.20) means localhost probably isn't
    # listening, so keep the bound host verbatim.
    case "$host" in
        ''|0.0.0.0|::|'[::]') host="localhost" ;;
    esac
    url="http://$host:$port"
    log "opening $url"
    case "$PULSE_OS" in
        linux)
            if need_cmd xdg-open; then xdg-open "$url" >/dev/null 2>&1 &
            elif need_cmd wslview; then wslview "$url" >/dev/null 2>&1 &
            else printf '  open this URL in your browser: %s\n' "$url"; fi
            ;;
        macos) open "$url" ;;
    esac
}

cmd_upgrade() {
    log "upgrading Pulse (re-running install script)..."
    # Forward all opt-in env vars to the installer so upgrades preserve shape
    # (e.g. a --client-only install doesn't accidentally grow a dashboard).
    # PULSE_AUTH_PASSWORD is deliberately NOT forwarded: the installer preserves
    # existing frontend.env via its own guard, and re-sending the password is a
    # footgun. PULSE_NO_INTERACT is also skipped — upgrades should be interactive.
    #
    # `exec` is critical: the installer overwrites ~/.local/bin/pulse mid-run,
    # and if this shell kept reading its own file afterwards dash would blow up
    # with a "Syntax error" when its byte offset hit the new file's content.
    # Replacing the process sidesteps that entirely.
    exec env \
        PULSE_VERSION="${PULSE_VERSION:-latest}" \
        PULSE_CLIENT_ONLY="${PULSE_CLIENT_ONLY:-0}" \
        PULSE_DASHBOARD_ONLY="${PULSE_DASHBOARD_ONLY:-0}" \
        PULSE_NO_START="${PULSE_NO_START:-0}" \
        PULSE_CLIENT_PORT="${PULSE_CLIENT_PORT:-}" \
        PULSE_DASHBOARD_PORT="${PULSE_DASHBOARD_PORT:-}" \
        sh -c 'curl -fsSL "https://raw.githubusercontent.com/'"$GITHUB_REPO"'/main/install/install.sh" | sh'
}

cmd_uninstall() {
    printf "%bWarning:%b this removes ALL Pulse installation files, configs, and service units.\n" "$YELLOW" "$NC"
    printf "  Files:   %s\n" "$INSTALL_ROOT"
    printf "  Configs: %s\n" "$CONFIG_ROOT"
    printf "  Logs:    %s\n" "$STATE_ROOT"
    printf "Continue? [y/N] "
    read -r ans
    case "$ans" in
        y|Y|yes|YES) ;;
        *) log "aborted"; exit 0 ;;
    esac

    log "stopping services"
    cmd_stop all 2>/dev/null || true

    log "removing service units"
    case "$PULSE_OS" in
        linux)
            systemctl --user disable pulse-client.service pulse.service 2>/dev/null || true
            rm -f "$HOME/.config/systemd/user/pulse-client.service" "$HOME/.config/systemd/user/pulse.service"
            systemctl --user daemon-reload
            ;;
        macos)
            for plist in "$HOME/Library/LaunchAgents/sh.pulse.client.plist" "$HOME/Library/LaunchAgents/sh.pulse.dashboard.plist"; do
                [ -f "$plist" ] && launchctl unload "$plist" 2>/dev/null || true
            done
            rm -f "$HOME/Library/LaunchAgents/sh.pulse.client.plist" "$HOME/Library/LaunchAgents/sh.pulse.dashboard.plist"
            ;;
    esac

    log "removing files"
    rm -rf "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT"
    rm -f "$HOME/.local/bin/pulse"
    log "done"
}

cmd_keys() {
    sub="${1:-show}"; shift 2>/dev/null || true
    case "$sub" in
        show)
            env_file="$CONFIG_ROOT/client.env"
            [ -f "$env_file" ] || die "client not installed"
            key="$(grep -E '^API_KEY=' "$env_file" | cut -d= -f2-)"
            printf "%bAPI_KEY:%b %s\n" "$BOLD" "$NC" "$key"
            ;;
        regen)
            env_file="$CONFIG_ROOT/client.env"
            [ -f "$env_file" ] || die "client not installed"
            new="$(openssl rand -hex 32 2>/dev/null || head -c 48 /dev/urandom | base64 | tr -d '\n' | head -c 64)"
            # sed -i not portable — use awk
            tmp="${env_file}.tmp.$$"
            awk -v k="$new" 'BEGIN{updated=0} /^API_KEY=/{print "API_KEY="k; updated=1; next}1 END{if(!updated) print "API_KEY="k}' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
            # Update servers.json if present — match the wrapper schema {"servers": [...]}
            # and pass values via env vars to avoid shell-quoting issues in the python.
            # We can't match by id anymore (post-1.4.10 the seeded local server is
            # srv-<uuid>, not "localhost"), so match by host+port against client.env.
            servers_file="$INSTALL_ROOT/frontend/data/servers.json"
            api_host="$(grep -E '^API_HOST=' "$env_file" | cut -d= -f2-)"
            api_port="$(grep -E '^API_PORT=' "$env_file" | cut -d= -f2-)"
            if [ -f "$servers_file" ] && need_cmd python3; then
                SERVERS_FILE="$servers_file" NEW_KEY="$new" \
                API_HOST="$api_host" API_PORT="$api_port" python3 <<'PY'
import json, os
p = os.environ['SERVERS_FILE']
with open(p) as f:
    data = json.load(f)
changed = False
want_host = os.environ['API_HOST']
want_port = int(os.environ['API_PORT'])
for s in (data.get('servers') or []):
    if s.get('host') == want_host and int(s.get('port', 0)) == want_port:
        s['apiKey'] = os.environ['NEW_KEY']
        changed = True
    # Legacy fallback: installs before 1.4.10 used id="localhost".
    elif s.get('id') == 'localhost':
        s['apiKey'] = os.environ['NEW_KEY']
        changed = True
if changed:
    with open(p, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
PY
            fi
            log "new API_KEY generated and written to client.env"
            log "restart client: pulse restart client"
            ;;
        *) die "unknown keys subcommand: $sub (use: show, regen)" ;;
    esac
}

# Replace (or append) a KEY=VALUE line in an .env file, preserving order and
# other entries. Uses a tempfile so readers never see a half-written file.
update_env_key() {
    env_file="$1"
    key="$2"
    value="$3"
    [ -f "$env_file" ] || die "env file not found: $env_file"
    tmp="${env_file}.tmp.$$"
    awk -v k="$key" -v v="$value" '
        BEGIN{updated=0}
        $0 ~ "^" k "=" {print k "=" v; updated=1; next}
        {print}
        END{if (!updated) print k "=" v}
    ' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
    chmod 600 "$env_file"
}

prompt_password_interactive() {
    if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
        die "cannot prompt for password (no /dev/tty). Use --stdin or set PULSE_AUTH_PASSWORD."
    fi
    trap 'stty echo < /dev/tty 2>/dev/null || true; printf "\n" > /dev/tty; exit 130' INT TERM
    printf "  New dashboard password: " > /dev/tty
    stty -echo < /dev/tty 2>/dev/null || true
    read -r pw1 < /dev/tty
    stty  echo < /dev/tty 2>/dev/null || true
    printf "\n  Confirm: " > /dev/tty
    stty -echo < /dev/tty 2>/dev/null || true
    read -r pw2 < /dev/tty
    stty  echo < /dev/tty 2>/dev/null || true
    printf "\n" > /dev/tty
    trap - INT TERM
    [ "$pw1" = "$pw2" ] || die "passwords don't match"
    [ -n "$pw1" ] || die "empty password not allowed"
    printf '%s' "$pw1"
}

cmd_config_edit() {
    sub="${1:-}"
    case "$sub" in
        client|dashboard) ;;
        *) die "usage: pulse config edit <client|dashboard>" ;;
    esac
    env_file="$CONFIG_ROOT/${sub}.env"
    [ -f "$env_file" ] || die "$sub not installed"
    "${EDITOR:-vi}" "$env_file"
}

cmd_config_password() {
    use_stdin=0
    for arg in "$@"; do
        case "$arg" in
            --stdin) use_stdin=1 ;;
            *) die "unknown arg: $arg (use: --stdin)" ;;
        esac
    done
    env_file="$CONFIG_ROOT/frontend.env"
    [ -f "$env_file" ] || die "dashboard not installed (no frontend.env)"
    if [ "$use_stdin" = 1 ]; then
        read -r pw
        [ -n "$pw" ] || die "empty password from stdin"
    elif [ -n "${PULSE_AUTH_PASSWORD:-}" ]; then
        pw="$PULSE_AUTH_PASSWORD"
    else
        pw="$(prompt_password_interactive)"
    fi
    update_env_key "$env_file" AUTH_PASSWORD "$pw"
    log "password updated"
    log "restarting dashboard..."
    cmd_restart dashboard 2>/dev/null || warn "could not restart dashboard automatically — run: pulse restart dashboard"
}

cmd_config_host() {
    new_client=""
    new_dashboard=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --client=*)    new_client="${1#*=}"; shift ;;
            --client)      shift; new_client="${1:-}"; shift || true ;;
            --dashboard=*) new_dashboard="${1#*=}"; shift ;;
            --dashboard)   shift; new_dashboard="${1:-}"; shift || true ;;
            -h|--help)
                printf "usage: pulse config host [--client HOST] [--dashboard HOST]\n"
                printf "  Without args, prints the current hosts.\n"
                return 0
                ;;
            *) die "unknown arg: $1 (use: --client HOST --dashboard HOST)" ;;
        esac
    done
    client_env="$CONFIG_ROOT/client.env"
    dash_env="$CONFIG_ROOT/frontend.env"
    cur_client="$(grep -E '^API_HOST=' "$client_env" 2>/dev/null | cut -d= -f2- || true)"
    cur_dash="$(grep -E '^WEB_HOST='  "$dash_env"   2>/dev/null | cut -d= -f2- || true)"
    if [ -z "$new_client" ] && [ -z "$new_dashboard" ]; then
        printf "%bcurrent hosts:%b\n" "$BOLD" "$NC"
        printf "  client API:   %s\n" "${cur_client:-?}"
        printf "  dashboard:    %s\n" "${cur_dash:-?}"
        printf "\n%busage:%b pulse config host [--client HOST] [--dashboard HOST]\n" "$DIM" "$NC"
        printf "\n%bcommon values:%b\n" "$BOLD" "$NC"
        printf "  127.0.0.1   — localhost only (default, safest)\n"
        printf "  0.0.0.0     — all interfaces (e.g. reach from phone on LAN)\n"
        return 0
    fi
    # Minimal validation: permit IPv4, hostnames, ::, and common IPv6 chars.
    validate_host() {
        case "$1" in
            ''|*[!0-9a-zA-Z.:-]*) die "invalid host: '$1'" ;;
        esac
    }
    [ -n "$new_client"    ] && validate_host "$new_client"
    [ -n "$new_dashboard" ] && validate_host "$new_dashboard"

    restart_client=0
    restart_dash=0

    if [ -n "$new_client" ] && [ "$new_client" != "$cur_client" ] && [ -f "$client_env" ]; then
        update_env_key "$client_env" API_HOST "$new_client"
        log "client API_HOST: ${cur_client:-?} → $new_client"
        restart_client=1
        case "$new_client" in
            0.0.0.0|\*) warn "client API is now reachable on all interfaces. Make sure the machine is behind a firewall or VPN." ;;
        esac
    fi

    if [ -n "$new_dashboard" ] && [ "$new_dashboard" != "$cur_dash" ] && [ -f "$dash_env" ]; then
        update_env_key "$dash_env" WEB_HOST "$new_dashboard"
        log "dashboard WEB_HOST: ${cur_dash:-?} → $new_dashboard"
        restart_dash=1
        case "$new_dashboard" in
            0.0.0.0|\*)
                warn "dashboard is now reachable on all interfaces over HTTP."
                warn "For public exposure, put it behind NGINX/Caddy with TLS and run: pulse config secure on"
                ;;
        esac
    fi

    [ "$restart_client" = 1 ] && cmd_restart client
    [ "$restart_dash"   = 1 ] && cmd_restart dashboard
    log "done"
}

cmd_config_secure() {
    val="${1:-}"
    env_file="$CONFIG_ROOT/frontend.env"
    [ -f "$env_file" ] || die "dashboard not installed (no frontend.env)"
    current="$(grep -E '^AUTH_COOKIE_SECURE=' "$env_file" | cut -d= -f2- || true)"
    case "$val" in
        on|true|yes|1)   new="true"  ;;
        off|false|no|0)  new="false" ;;
        ''|show)
            printf "%bAUTH_COOKIE_SECURE:%b %s\n" "$BOLD" "$NC" "${current:-?}"
            printf "\n%busage:%b pulse config secure <on|off>\n" "$DIM" "$NC"
            printf "  on  — required when behind HTTPS (production / reverse proxy)\n"
            printf "  off — dev only; the cookie works over plain HTTP\n"
            return 0
            ;;
        *) die "usage: pulse config secure <on|off>" ;;
    esac
    if [ "$current" = "$new" ]; then
        log "AUTH_COOKIE_SECURE is already $new — no change"
        return 0
    fi
    update_env_key "$env_file" AUTH_COOKIE_SECURE "$new"
    log "AUTH_COOKIE_SECURE: ${current:-?} → $new"
    [ "$new" = "false" ] && warn "cookie will be sent over HTTP — use this in development only."
    cmd_restart dashboard
}

cmd_config_rotate_jwt() {
    yes=0
    for arg in "$@"; do
        case "$arg" in
            -y|--yes) yes=1 ;;
            -h|--help)
                printf "usage: pulse config rotate-jwt [-y|--yes]\n"
                printf "  Regenerates AUTH_JWT_SECRET. Every active dashboard login will be\n"
                printf "  invalidated and users will be bounced back to /login.\n"
                return 0
                ;;
            *) die "unknown arg: $arg (use: -y|--yes)" ;;
        esac
    done
    env_file="$CONFIG_ROOT/frontend.env"
    [ -f "$env_file" ] || die "dashboard not installed (no frontend.env)"
    if [ "$yes" = 0 ]; then
        printf "%bWarning:%b rotating AUTH_JWT_SECRET invalidates every active login.\n" "$YELLOW" "$NC"
        printf "  Everyone currently on the dashboard will be sent back to /login.\n"
        printf "Continue? [y/N] "
        read -r ans
        case "$ans" in
            y|Y|yes|YES) ;;
            *) log "aborted"; return 0 ;;
        esac
    fi
    if need_cmd openssl; then
        new_secret="$(openssl rand -hex 32)"
    else
        new_secret="$(head -c 48 /dev/urandom | base64 | tr -d '\n' | head -c 64)"
    fi
    update_env_key "$env_file" AUTH_JWT_SECRET "$new_secret"
    log "AUTH_JWT_SECRET rotated (old sessions invalidated)"
    cmd_restart dashboard
}

cmd_config_ports() {
    new_client=""
    new_dashboard=""
    while [ "$#" -gt 0 ]; do
        case "$1" in
            --client=*)    new_client="${1#*=}"; shift ;;
            --client)      shift; new_client="${1:-}"; shift || true ;;
            --dashboard=*) new_dashboard="${1#*=}"; shift ;;
            --dashboard)   shift; new_dashboard="${1:-}"; shift || true ;;
            -h|--help)
                printf "usage: pulse config ports [--client N] [--dashboard N]\n"
                printf "  Without args, prints the current ports.\n"
                return 0
                ;;
            *) die "unknown arg: $1 (use: --client N --dashboard N)" ;;
        esac
    done
    client_env="$CONFIG_ROOT/client.env"
    dash_env="$CONFIG_ROOT/frontend.env"
    cur_client="$(grep -E '^API_PORT=' "$client_env" 2>/dev/null | cut -d= -f2- || true)"
    cur_dash="$(grep -E '^WEB_PORT='  "$dash_env"   2>/dev/null | cut -d= -f2- || true)"
    if [ -z "$new_client" ] && [ -z "$new_dashboard" ]; then
        printf "%bcurrent ports:%b\n" "$BOLD" "$NC"
        printf "  client API:   %s\n" "${cur_client:-?}"
        printf "  dashboard:    %s\n" "${cur_dash:-?}"
        printf "\n%busage:%b pulse config ports [--client N] [--dashboard N]\n" "$DIM" "$NC"
        return 0
    fi
    validate_port() {
        case "$1" in
            ''|*[!0-9]*) die "invalid port: '$1' (must be integer)" ;;
        esac
        [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] || die "port out of range: $1 (1024-65535)"
    }
    [ -n "$new_client"    ] && validate_port "$new_client"
    [ -n "$new_dashboard" ] && validate_port "$new_dashboard"

    restart_client=0
    restart_dash=0

    if [ -n "$new_client" ] && [ "$new_client" != "$cur_client" ] && [ -f "$client_env" ]; then
        update_env_key "$client_env" API_PORT "$new_client"
        log "client API_PORT: ${cur_client:-?} → $new_client"
        restart_client=1
        servers_file="$INSTALL_ROOT/frontend/data/servers.json"
        # Match by (host, old_port) instead of id — id is srv-<uuid> after 1.4.10.
        cur_api_host="$(grep -E '^API_HOST=' "$client_env" | cut -d= -f2-)"
        if [ -f "$servers_file" ] && need_cmd python3; then
            SERVERS_FILE="$servers_file" NEW_PORT="$new_client" \
            API_HOST="$cur_api_host" OLD_PORT="$cur_client" python3 <<'PY'
import json, os
p = os.environ['SERVERS_FILE']
with open(p) as f:
    data = json.load(f)
changed = False
want_host = os.environ['API_HOST']
old_port = int(os.environ['OLD_PORT']) if os.environ['OLD_PORT'] else None
for s in (data.get('servers') or []):
    match = s.get('host') == want_host and (old_port is None or int(s.get('port', 0)) == old_port)
    # Legacy fallback: installs before 1.4.10 used id="localhost".
    if match or s.get('id') == 'localhost':
        s['port'] = int(os.environ['NEW_PORT'])
        changed = True
if changed:
    with open(p, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
PY
            log "updated local server port in servers.json"
            restart_dash=1
        fi
    fi

    if [ -n "$new_dashboard" ] && [ "$new_dashboard" != "$cur_dash" ] && [ -f "$dash_env" ]; then
        update_env_key "$dash_env" WEB_PORT "$new_dashboard"
        log "dashboard WEB_PORT: ${cur_dash:-?} → $new_dashboard"
        restart_dash=1
    fi

    [ "$restart_client" = 1 ] && cmd_restart client
    [ "$restart_dash"   = 1 ] && cmd_restart dashboard
    log "done"
}

cmd_config_paths() {
    bin_path="$(command -v pulse 2>/dev/null || printf '%s' "$HOME/.local/bin/pulse")"
    printf "%bPulse paths:%b\n" "$BOLD" "$NC"
    printf "  %binstall:%b            %s\n" "$DIM" "$NC" "$INSTALL_ROOT"
    printf "  %bconfig:%b             %s\n" "$DIM" "$NC" "$CONFIG_ROOT"
    case "$PULSE_OS" in
        linux) printf "  %blogs:%b               journalctl --user -u pulse-client.service -u pulse.service\n" "$DIM" "$NC" ;;
        macos) printf "  %blogs:%b               %s\n" "$DIM" "$NC" "$STATE_ROOT/logs" ;;
    esac
    printf "  %bdata (dashboard):%b   %s\n" "$DIM" "$NC" "$INSTALL_ROOT/frontend/data"
    printf "  %bdata (client):%b      %s\n" "$DIM" "$NC" "$INSTALL_ROOT/client/data"
    printf "  %bbinary:%b             %s\n" "$DIM" "$NC" "$bin_path"
    case "$PULSE_OS" in
        linux) printf "  %bunits:%b              %s/pulse*.service\n" "$DIM" "$NC" "$HOME/.config/systemd/user" ;;
        macos) printf "  %bplists:%b             %s/sh.pulse.*.plist\n" "$DIM" "$NC" "$HOME/Library/LaunchAgents" ;;
    esac
}

cmd_config_open() {
    target="${1:-}"
    # `data` kept as a retrocompat alias for `data-dashboard`.
    case "$target" in
        config)            dir="$CONFIG_ROOT" ;;
        install)           dir="$INSTALL_ROOT" ;;
        logs)
            case "$PULSE_OS" in
                linux)
                    # No log dir on Linux — logs go to journald. Point the user
                    # at `pulse logs` instead of opening an empty directory.
                    printf "  On Linux, logs live in the systemd journal, not on disk.\n"
                    printf "  Use: %bpulse logs%b         (last 100 lines from both services)\n" "$BOLD" "$NC"
                    printf "       %bpulse logs -f%b      (follow)\n"                            "$BOLD" "$NC"
                    printf "       %bpulse logs client%b  (only client)\n"                       "$BOLD" "$NC"
                    return 0
                    ;;
                macos) dir="$STATE_ROOT/logs" ;;
            esac
            ;;
        data|data-dashboard) dir="$INSTALL_ROOT/frontend/data" ;;
        data-client)         dir="$INSTALL_ROOT/client/data" ;;
        ''|-h|--help|help) die "usage: pulse config open <config|install|logs|data-dashboard|data-client>" ;;
        *)                 die "unknown target: '$target' (use: config, install, logs, data-dashboard, data-client)" ;;
    esac
    [ -d "$dir" ] || die "directory not found: $dir"
    log "opening $dir"
    case "$PULSE_OS" in
        linux)
            if need_cmd xdg-open; then xdg-open "$dir" >/dev/null 2>&1 &
            elif need_cmd wslview; then wslview "$dir" >/dev/null 2>&1 &
            else printf "  path: %s\n" "$dir"; fi
            ;;
        macos) open "$dir" ;;
    esac
}

cmd_config() {
    sub="${1:-}"
    [ "$#" -gt 0 ] && shift || true
    case "$sub" in
        edit)       cmd_config_edit "$@" ;;
        password)   cmd_config_password "$@" ;;
        ports)      cmd_config_ports "$@" ;;
        host|hosts) cmd_config_host "$@" ;;
        secure)     cmd_config_secure "$@" ;;
        rotate-jwt) cmd_config_rotate_jwt "$@" ;;
        paths)      cmd_config_paths "$@" ;;
        open)       cmd_config_open "$@" ;;
        ''|help|-h|--help)
            cat <<EOF
${BOLD}Usage:${NC} pulse config <subcommand> [args]

${BOLD}Subcommands:${NC}
  edit <client|dashboard>       open .env in \$EDITOR
  password [--stdin]            change the dashboard password (interactive by default)
  ports [--client N] [--dashboard N]
                                show current ports, or change them (auto-restarts)
  host [--client H] [--dashboard H]
                                show current bind hosts, or change them (use 0.0.0.0 to expose)
  secure <on|off>               toggle AUTH_COOKIE_SECURE (on = behind HTTPS, off = dev)
  rotate-jwt [-y|--yes]         regenerate AUTH_JWT_SECRET (logs everyone out)
  paths                         print install / config / logs / data paths
  open <config|install|logs|data-dashboard|data-client>
                                open the relevant directory in your file manager
EOF
            ;;
        *) die "unknown config subcommand: '$sub' (run: pulse config help)" ;;
    esac
}

# Reads the installed version. Preference order:
#   1. $INSTALL_ROOT/VERSION — written by install.sh on every run (source of truth)
#   2. $CONFIG_ROOT/client.env:VERSION — legacy fallback for pre-1.4.11 installs
# Prints the bare version string (e.g. "1.4.11") or empty string if unknown.
resolve_installed_version() {
    if [ -f "$INSTALL_ROOT/VERSION" ]; then
        v="$(head -n1 "$INSTALL_ROOT/VERSION" | tr -d '[:space:]')"
        [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    fi
    if [ -f "$CONFIG_ROOT/client.env" ]; then
        v="$(grep -E '^VERSION=' "$CONFIG_ROOT/client.env" | cut -d= -f2-)"
        [ -n "$v" ] && { printf '%s' "$v"; return 0; }
    fi
    return 1
}

cmd_version() {
    if v="$(resolve_installed_version)" && [ -n "$v" ]; then
        printf "Pulse %s\n" "$v"
    else
        printf "Pulse (not installed via install.sh)\n"
    fi
}

cmd_check_updates() {
    log "checking GitHub Releases for latest version..."
    latest="$(curl -fsSL "https://api.github.com/repos/$GITHUB_REPO/releases/latest" | grep '"tag_name":' | head -1 | cut -d '"' -f 4)"
    [ -n "$latest" ] || die "could not query latest version"
    current=""
    if v="$(resolve_installed_version)" && [ -n "$v" ]; then
        current="v$v"
    fi
    printf "  installed: %s\n" "${current:-unknown}"
    printf "  latest:    %s\n" "$latest"
    if [ "$current" != "$latest" ] && [ -n "$current" ]; then
        printf "\n  %bUpdate available.%b Run %bpulse upgrade%b to install.\n" "$GREEN" "$NC" "$BOLD" "$NC"
    else
        printf "\n  %bYou're on the latest version.%b\n" "$GREEN" "$NC"
    fi
}

cmd_help() {
    cat <<EOF
${BOLD}Pulse${NC} — persistent terminal sessions dashboard

${BOLD}Usage:${NC} pulse <command> [args]

${BOLD}Service commands:${NC}
  status                show status of client + dashboard services
  start    [target]     start services (target: client, dashboard, all — default all)
  stop     [target]     stop services
  restart  [target]     restart services
  logs     [target] [-f]  show/follow logs (target: client, dashboard, all — default all)

${BOLD}Dashboard:${NC}
  open                  open the dashboard in your browser

${BOLD}Lifecycle:${NC}
  upgrade               fetch latest release and reinstall
  uninstall             remove all files, configs, and services
  version               print installed version
  check-updates         query GitHub for newer versions (opt-in network call)

${BOLD}Config:${NC}
  keys show             print the client's API_KEY
  keys regen            generate new API_KEY, update servers.json
  config edit <client|dashboard>        open .env in \$EDITOR
  config password                       change the dashboard password
  config ports [--client N] [--dashboard N]
                                        show or change service ports
  config host  [--client H] [--dashboard H]
                                        show or change bind hosts (0.0.0.0 exposes)
  config secure <on|off>                toggle AUTH_COOKIE_SECURE
  config rotate-jwt                     rotate AUTH_JWT_SECRET (logs everyone out)
  config paths                          print install / config / logs paths
  config open <config|install|logs|data-dashboard|data-client>
                                        open that directory in your file manager

${BOLD}Links:${NC}
  github.com/${GITHUB_REPO}
EOF
}

# -----------------------------------------------------------------------------
# Dispatch
# -----------------------------------------------------------------------------
detect_os

cmd="${1:-help}"
[ "$#" -gt 0 ] && shift
case "$cmd" in
    status)        cmd_status "$@" ;;
    start)         cmd_start "$@" ;;
    stop)          cmd_stop "$@" ;;
    restart)       cmd_restart "$@" ;;
    logs)          cmd_logs "$@" ;;
    open)          cmd_open "$@" ;;
    upgrade)       cmd_upgrade "$@" ;;
    uninstall)     cmd_uninstall "$@" ;;
    keys)          cmd_keys "$@" ;;
    config)        cmd_config "$@" ;;
    version|-v|--version)   cmd_version "$@" ;;
    check-updates) cmd_check_updates "$@" ;;
    help|-h|--help|"") cmd_help ;;
    *) die "unknown command: $cmd (run: pulse help)" ;;
esac
