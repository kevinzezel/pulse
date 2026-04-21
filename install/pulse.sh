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
    YELLOW='\033[1;33m'; GREEN='\033[1;32m'; RED='\033[1;31m'
    BLUE='\033[1;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    YELLOW=''; GREEN=''; RED=''; BLUE=''; BOLD=''; DIM=''; NC=''
fi

log()  { printf "%b[pulse]%b %s\n" "$GREEN" "$NC" "$*"; }
err()  { printf "%b[pulse]%b %s\n" "$RED"   "$NC" "$*" 1>&2; }
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
            -f|--follow) follow="1"; shift ;;
            client|dashboard) target="$1"; shift ;;
            *) die "unknown arg: $1 (use: [client|dashboard] [-f])" ;;
        esac
    done
    target="${target:-client}"
    case "$PULSE_OS" in
        linux)
            unit="pulse-client.service"
            [ "$target" = "dashboard" ] && unit="pulse.service"
            if [ -n "$follow" ]; then
                journalctl --user -u "$unit" -f
            else
                journalctl --user -u "$unit" --no-pager -n 100
            fi
            ;;
        macos)
            log_file="$STATE_ROOT/logs/client.log"
            [ "$target" = "dashboard" ] && log_file="$STATE_ROOT/logs/dashboard.log"
            [ -f "$log_file" ] || die "log file not found: $log_file"
            if [ -n "$follow" ]; then
                tail -f "$log_file"
            else
                tail -n 100 "$log_file"
            fi
            ;;
    esac
}

cmd_open() {
    env_file="$CONFIG_ROOT/frontend.env"
    [ -f "$env_file" ] || die "dashboard not installed (no frontend.env)"
    port="$(grep -E '^WEB_PORT=' "$env_file" | cut -d= -f2-)"
    url="http://localhost:$port"
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
    # Forward opt-in env vars (PULSE_VERSION, PULSE_CLIENT_ONLY, etc.) through to installer.
    curl -fsSL "https://raw.githubusercontent.com/$GITHUB_REPO/main/install/install.sh" \
        | PULSE_VERSION="${PULSE_VERSION:-latest}" sh
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
            servers_file="$INSTALL_ROOT/frontend/data/servers.json"
            if [ -f "$servers_file" ] && need_cmd python3; then
                SERVERS_FILE="$servers_file" NEW_KEY="$new" python3 <<'PY'
import json, os
p = os.environ['SERVERS_FILE']
with open(p) as f:
    data = json.load(f)
changed = False
for s in (data.get('servers') or []):
    if s.get('id') == 'localhost':
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

cmd_config() {
    sub="${1:-}"
    case "$sub" in
        client|dashboard) ;;
        *) die "usage: pulse config edit <client|dashboard>" ;;
    esac
    env_file="$CONFIG_ROOT/${sub}.env"
    [ -f "$env_file" ] || die "$sub not installed"
    "${EDITOR:-vi}" "$env_file"
}

cmd_version() {
    if [ -f "$CONFIG_ROOT/client.env" ]; then
        v="$(grep -E '^VERSION=' "$CONFIG_ROOT/client.env" | cut -d= -f2-)"
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
    if [ -f "$CONFIG_ROOT/client.env" ]; then
        current="v$(grep -E '^VERSION=' "$CONFIG_ROOT/client.env" | cut -d= -f2-)"
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
  logs     [target] [-f]  show/follow logs

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
  config edit <client|dashboard>   open .env in \$EDITOR

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
