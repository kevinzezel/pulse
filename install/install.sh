#!/bin/sh
# Pulse installer — github.com/kevinzezel/pulse
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/kevinzezel/pulse/main/install/install.sh | sh
#
# Flags (via env vars, since `curl | sh` cannot pass args easily):
#   PULSE_VERSION=v1.2.0            pin a specific release (default: latest)
#   PULSE_CLIENT_ONLY=1             install only the client (no dashboard)
#   PULSE_DASHBOARD_ONLY=1          install only the dashboard (no client)
#   PULSE_NO_START=1                don't enable/start services after install
#   PULSE_NO_INTERACT=1             skip prompts; requires PULSE_AUTH_PASSWORD
#   PULSE_AUTH_PASSWORD=secret      dashboard password (required if non-interactive)
#   PULSE_CLIENT_PORT=7845          client port (default: 7845)
#   PULSE_DASHBOARD_PORT=3000       dashboard port (default: 3000)
#
set -eu

# -----------------------------------------------------------------------------
# Configuration
# -----------------------------------------------------------------------------
REPO_OWNER="kevinzezel"
REPO_NAME="pulse"
GITHUB_REPO="${REPO_OWNER}/${REPO_NAME}"
PULSE_VERSION="${PULSE_VERSION:-latest}"
PULSE_CLIENT_ONLY="${PULSE_CLIENT_ONLY:-0}"
PULSE_DASHBOARD_ONLY="${PULSE_DASHBOARD_ONLY:-0}"
PULSE_NO_START="${PULSE_NO_START:-0}"
PULSE_NO_INTERACT="${PULSE_NO_INTERACT:-0}"
PULSE_CLIENT_PORT="${PULSE_CLIENT_PORT:-7845}"
PULSE_DASHBOARD_PORT="${PULSE_DASHBOARD_PORT:-3000}"

INSTALL_ROOT="$HOME/.local/share/pulse"
CONFIG_ROOT="$HOME/.config/pulse"
STATE_ROOT="$HOME/.local/state/pulse"
BIN_ROOT="$HOME/.local/bin"

# -----------------------------------------------------------------------------
# Colors + logging
# -----------------------------------------------------------------------------
if [ -t 1 ]; then
    YELLOW='\033[1;33m'; GREEN='\033[1;32m'; RED='\033[1;31m'
    BLUE='\033[1;34m'; BOLD='\033[1m'; DIM='\033[2m'; NC='\033[0m'
else
    YELLOW=''; GREEN=''; RED=''; BLUE=''; BOLD=''; DIM=''; NC=''
fi

log()    { printf "%b[pulse]%b %s\n" "$GREEN"  "$NC" "$*"; }
warn()   { printf "%b[pulse]%b %s\n" "$YELLOW" "$NC" "$*"; }
err()    { printf "%b[pulse]%b %s\n" "$RED"    "$NC" "$*" 1>&2; }
status() { printf "%b▸%b %s\n"       "$BLUE"   "$NC" "$*"; }
ok()     { printf "%b✓%b %s\n"       "$GREEN"  "$NC" "$*"; }
die()    { err "$*"; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# -----------------------------------------------------------------------------
# Platform detection
# -----------------------------------------------------------------------------
detect_platform() {
    case "$(uname -s)" in
        Linux)
            PULSE_OS=linux
            case "$(uname -r)" in
                *icrosoft*WSL2*|*icrosoft*wsl2*) PULSE_IS_WSL=1 ;;
                *)                                PULSE_IS_WSL=0 ;;
            esac
            if need_cmd apt-get; then
                PULSE_PM=apt
            else
                die "Pulse v1 supports apt-based distros only (Debian/Ubuntu/WSL Ubuntu). Open an issue for Fedora/Arch support: https://github.com/${GITHUB_REPO}/issues"
            fi
            ;;
        Darwin)
            PULSE_OS=macos
            PULSE_IS_WSL=0
            if ! need_cmd brew; then
                die "Homebrew not found. Install from https://brew.sh first, then rerun."
            fi
            PULSE_PM=brew
            ;;
        *)
            die "Unsupported OS: $(uname -s)"
            ;;
    esac
    case "$(uname -m)" in
        x86_64|amd64)  PULSE_ARCH=amd64 ;;
        aarch64|arm64) PULSE_ARCH=arm64 ;;
        *) die "Unsupported architecture: $(uname -m)" ;;
    esac
}

setup_sudo() {
    if [ "$(id -u)" = 0 ]; then
        PULSE_SUDO=""
    elif need_cmd sudo; then
        PULSE_SUDO="sudo"
    elif need_cmd doas; then
        PULSE_SUDO="doas"
    else
        die "No sudo or doas available — rerun as root or install one."
    fi
}

# -----------------------------------------------------------------------------
# Dep installation
# -----------------------------------------------------------------------------
install_packages() {
    [ "$#" -eq 0 ] && return 0
    case "$PULSE_PM" in
        apt)
            $PULSE_SUDO apt-get update -qq
            $PULSE_SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
            ;;
        brew)
            brew install "$@"
            ;;
    esac
}

ensure_uv() {
    if need_cmd uv; then return 0; fi
    if [ -x "$HOME/.local/bin/uv" ]; then
        PATH="$HOME/.local/bin:$PATH"; export PATH
        return 0
    fi
    log "installing uv"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"; export PATH
    need_cmd uv || die "uv installation failed"
}

node_ok() {
    need_cmd node || return 1
    v="$(node -v)"; v="${v#v}"
    major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
    if [ "$major" -gt 18 ]; then return 0; fi
    # Next 15 requires Node >= 18.18
    if [ "$major" -eq 18 ] && [ "$minor" -ge 18 ]; then return 0; fi
    return 1
}

ensure_node() {
    # On macOS the launchd PATH can't see nvm / fnm / asdf — so even if the
    # user's shell has a modern node, the dashboard service (via launchd)
    # won't. Always install node@20 via brew there, regardless of what `node`
    # reports in the installer's shell.
    if [ "$PULSE_PM" = brew ]; then
        if ! brew list --formula node@20 >/dev/null 2>&1; then
            log "installing node@20 via brew (launchd can't see nvm/fnm/asdf)"
            brew install node@20
        fi
        brew link --overwrite --force node@20 2>/dev/null || true
        return 0
    fi
    # Linux / apt: skip reinstall if the system node is already recent enough.
    node_ok && return 0
    case "$PULSE_PM" in
        apt)
            log "installing Node.js 20 via NodeSource"
            curl -fsSL https://deb.nodesource.com/setup_20.x | $PULSE_SUDO -E bash -
            $PULSE_SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs
            ;;
    esac
    node_ok || die "Node.js 18.18+ installation failed"
}

ensure_runtime_deps() {
    status "checking runtime dependencies"
    need=""
    need_cmd tmux    || need="$need tmux"
    need_cmd python3 || need="$need python3"
    need_cmd curl    || need="$need curl"
    need_cmd openssl || need="$need openssl"
    need_cmd tar     || need="$need tar"
    if [ "$PULSE_PM" = apt ] && need_cmd python3 && ! python3 -c "import venv" >/dev/null 2>&1; then
        need="$need python3-venv"
    fi
    need="$(printf '%s' "$need" | sed 's/^ *//')"
    if [ -n "$need" ]; then
        log "installing system packages: $need"
        # shellcheck disable=SC2086
        install_packages $need
    fi
    # Fail fast if the system python3 is too old. uv can download a newer one
    # for the client venv, but some uv/pip helper scripts still run against the
    # system python, and 3.10 is the floor we actually test against.
    if [ "$PULSE_DASHBOARD_ONLY" = 0 ] && need_cmd python3; then
        if ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
            py_ver="$(python3 -c 'import sys; print("{0}.{1}".format(*sys.version_info))' 2>/dev/null || echo '?')"
            die "Python 3.10+ required (found $py_ver). Please install a newer python3 and rerun."
        fi
    fi
    [ "$PULSE_DASHBOARD_ONLY" = 0 ] && ensure_uv
    [ "$PULSE_CLIENT_ONLY"    = 0 ] && ensure_node
    ok "runtime deps ready"
}

# -----------------------------------------------------------------------------
# Download + extract
# -----------------------------------------------------------------------------
resolve_download_url() {
    if [ "$PULSE_VERSION" = "latest" ]; then
        api_url="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
    else
        api_url="https://api.github.com/repos/$GITHUB_REPO/releases/tags/$PULSE_VERSION"
    fi
    url="$(curl -fsSL "$api_url" \
        | grep '"browser_download_url":' \
        | grep -o '"https://[^"]*pulse-[^"]*\.tar\.gz"' \
        | head -n 1 \
        | tr -d '"')"
    [ -n "$url" ] || die "could not resolve tarball URL for version '$PULSE_VERSION' from $api_url"
    printf '%s' "$url"
}

verify_checksum() {
    # SHA256SUMS lives next to the tarball in the same release, so we derive
    # its URL by swapping the basename. Missing sums file is non-fatal (warn);
    # mismatch is fatal. Users who want strict enforcement can pin PULSE_VERSION.
    tarball="$1"
    sums_url="$(printf '%s' "$DOWNLOAD_URL" | sed 's|/[^/]*$|/SHA256SUMS|')"
    sums_file="$TEMP_DIR/SHA256SUMS"
    if ! curl -fsSL "$sums_url" -o "$sums_file" 2>/dev/null; then
        warn "SHA256SUMS not found — skipping checksum verification"
        return 0
    fi
    expected="$(grep 'pulse-.*\.tar\.gz' "$sums_file" | awk '{print $1}' | head -n 1)"
    if [ -z "$expected" ]; then
        warn "SHA256SUMS has no pulse tarball entry — skipping verification"
        return 0
    fi
    if need_cmd sha256sum; then
        actual="$(sha256sum "$tarball" | awk '{print $1}')"
    elif need_cmd shasum; then
        actual="$(shasum -a 256 "$tarball" | awk '{print $1}')"
    else
        warn "no sha256sum/shasum tool available — skipping checksum verification"
        return 0
    fi
    [ "$actual" = "$expected" ] || die "checksum mismatch: expected $expected, got $actual"
    ok "checksum verified"
}

download_and_extract() {
    status "downloading Pulse ($PULSE_VERSION)"
    DOWNLOAD_URL="$(resolve_download_url)"
    log "$DOWNLOAD_URL"
    curl -fsSL "$DOWNLOAD_URL" -o "$TEMP_DIR/pulse.tar.gz" || die "download failed"
    verify_checksum "$TEMP_DIR/pulse.tar.gz"
    tar -xzf "$TEMP_DIR/pulse.tar.gz" -C "$TEMP_DIR" || die "tarball extraction failed"
    # GitHub tarball creates <repo>-<version>/ — pick it up
    EXTRACTED="$(find "$TEMP_DIR" -mindepth 1 -maxdepth 1 -type d ! -name 'pulse.*' | head -n 1)"
    [ -n "$EXTRACTED" ] && [ -d "$EXTRACTED" ] || die "extracted tarball has unexpected structure"
    # Version string from dir name: "pulse-v1.2.0" → "1.2.0", "pulse-1.2.0" → "1.2.0".
    # We strip the leading 'v' so `pulse.sh check-updates` can re-add it consistently
    # when comparing with the GitHub tag_name (which does keep the 'v').
    PULSE_INSTALLED_VERSION="$(basename "$EXTRACTED" | sed -e 's/^pulse-//' -e 's/^v//')"
    ok "extracted $PULSE_INSTALLED_VERSION"
}

# -----------------------------------------------------------------------------
# File placement
# -----------------------------------------------------------------------------
stop_services_if_running() {
    case "$PULSE_OS" in
        linux)
            # Stop only the main process, not the whole cgroup. The client
            # spawns `tmux new-session -d`, which daemonises but stays in the
            # unit's cgroup (fork doesn't escape cgroups v2). A regular
            # `systemctl stop` with the default KillMode=control-group would
            # also take the tmux daemon with it, wiping every live session on
            # every upgrade. `kill --kill-who=main` signals only the main PID
            # regardless of KillMode — works even when the installed unit file
            # hasn't picked up the newer KillMode=process yet. Ordering matters:
            # send TERM first, give uvicorn time to exit cleanly, only then
            # install_files() starts overwriting disk.
            for unit in pulse-client.service pulse.service; do
                if systemctl --user is-active --quiet "$unit" 2>/dev/null; then
                    systemctl --user kill --kill-who=main --signal=TERM "$unit" 2>/dev/null || true
                fi
            done
            # Give uvicorn / next a beat to shut down before we rm -rf the install dir.
            sleep 2
            ;;
        macos)
            launchctl unload "$HOME/Library/LaunchAgents/sh.pulse.client.plist"    2>/dev/null || true
            launchctl unload "$HOME/Library/LaunchAgents/sh.pulse.dashboard.plist" 2>/dev/null || true
            ;;
    esac
}

install_files() {
    status "installing files to $INSTALL_ROOT"
    mkdir -p "$INSTALL_ROOT" "$CONFIG_ROOT" "$STATE_ROOT/logs" "$BIN_ROOT"

    # Stop running services so we can overwrite dirs without crashing in-flight requests.
    stop_services_if_running

    if [ "$PULSE_DASHBOARD_ONLY" = 0 ]; then
        # Preserve user data (settings.json with Telegram config, session state, etc.)
        # across upgrades — mirrors the frontend/data handling below.
        client_data_backup=""
        if [ -d "$INSTALL_ROOT/client/data" ]; then
            client_data_backup="$TEMP_DIR/client-data-backup"
            log "preserving existing client/data for upgrade"
            mv "$INSTALL_ROOT/client/data" "$client_data_backup"
        fi
        rm -rf "$INSTALL_ROOT/client"
        cp -R "$EXTRACTED/client" "$INSTALL_ROOT/client"
        if [ -n "$client_data_backup" ] && [ -d "$client_data_backup" ]; then
            rm -rf "$INSTALL_ROOT/client/data"
            mv "$client_data_backup" "$INSTALL_ROOT/client/data"
            log "restored client/data"
        fi
        log "setting up Python environment for client (this may take a minute)"
        # uv sync requires pyproject.toml which we don't ship (would need to commit one).
        # Use uv venv + uv pip instead — works off the existing requirements.txt.
        # Pin the interpreter from .python-version so users with pyenv/asdf defaulting
        # to an old Python don't end up with a broken venv.
        (
            cd "$INSTALL_ROOT/client"
            if [ -f .python-version ]; then
                py_version="$(tr -d '[:space:]' < .python-version)"
                uv venv .venv --python "$py_version" --quiet >/dev/null 2>&1 \
                    || die "uv venv failed for Python $py_version (uv may need to download it; check network)"
            else
                uv venv .venv --quiet >/dev/null 2>&1 || die "uv venv failed"
            fi
            uv pip install --python .venv/bin/python --quiet -r requirements.txt
        ) || die "Python environment setup failed"
    fi

    if [ "$PULSE_CLIENT_ONLY" = 0 ]; then
        # Preserve user data (notes, flows, servers.json, etc.) across upgrades.
        data_backup=""
        if [ -d "$INSTALL_ROOT/frontend/data" ]; then
            data_backup="$TEMP_DIR/frontend-data-backup"
            log "preserving existing frontend/data for upgrade"
            mv "$INSTALL_ROOT/frontend/data" "$data_backup"
        fi
        rm -rf "$INSTALL_ROOT/frontend"
        cp -R "$EXTRACTED/frontend" "$INSTALL_ROOT/frontend"

        log "installing dashboard dependencies (this may take 1-2 minutes)"
        # Install full deps — the build step needs devDependencies (tailwind, postcss).
        # We prune devDependencies after the build to reclaim disk space.
        if [ -f "$INSTALL_ROOT/frontend/package-lock.json" ]; then
            (cd "$INSTALL_ROOT/frontend" && npm ci      --loglevel=error 2>&1 | tail -5) || die "npm ci failed"
        else
            (cd "$INSTALL_ROOT/frontend" && npm install --loglevel=error 2>&1 | tail -5) || die "npm install failed"
        fi
        log "building dashboard"
        (cd "$INSTALL_ROOT/frontend" && npm run build 2>&1 | tail -10) || die "npm run build failed"
        log "pruning dev dependencies"
        (cd "$INSTALL_ROOT/frontend" && npm prune --omit=dev --loglevel=error 2>&1 | tail -3) || warn "npm prune failed (non-fatal)"

        # Restore preserved user data
        if [ -n "$data_backup" ] && [ -d "$data_backup" ]; then
            rm -rf "$INSTALL_ROOT/frontend/data"
            mv "$data_backup" "$INSTALL_ROOT/frontend/data"
            log "restored frontend/data"
        fi
    fi

    cp "$EXTRACTED/install/pulse.sh" "$BIN_ROOT/pulse"
    chmod +x "$BIN_ROOT/pulse"
    # Single source of truth for `pulse version` / `pulse check-updates`.
    # Written every install & upgrade so the CLI sees the fresh value even
    # when client.env is preserved (which is what was silently freezing
    # `pulse version` at the pre-upgrade release).
    printf '%s\n' "$PULSE_INSTALLED_VERSION" > "$INSTALL_ROOT/VERSION"
    ok "files installed"
}

# -----------------------------------------------------------------------------
# Env files
# -----------------------------------------------------------------------------
hex_secret() {
    if need_cmd openssl; then
        openssl rand -hex 32
    else
        head -c 48 /dev/urandom | base64 | tr -d '\n' | head -c 64
    fi
}

prompt_password() {
    # Non-interactive path (CI, automation): require PULSE_AUTH_PASSWORD to be set.
    if [ "$PULSE_NO_INTERACT" = 1 ] || [ -n "${PULSE_AUTH_PASSWORD:-}" ]; then
        [ -n "${PULSE_AUTH_PASSWORD:-}" ] || die "PULSE_NO_INTERACT=1 but PULSE_AUTH_PASSWORD is not set"
        printf '%s' "$PULSE_AUTH_PASSWORD"
        return 0
    fi
    # Interactive path: under `curl | sh`, stdin is the pipe — read from /dev/tty.
    if [ ! -r /dev/tty ] || [ ! -w /dev/tty ]; then
        die "cannot prompt for password (no /dev/tty). Re-run with PULSE_AUTH_PASSWORD=yourpassword or set PULSE_NO_INTERACT=1."
    fi
    # Ensure Ctrl+C / SIGTERM restore echo so the terminal doesn't end up mute.
    trap 'stty echo < /dev/tty 2>/dev/null || true; printf "\n" > /dev/tty; exit 130' INT TERM
    printf "%b  Dashboard login password:%b " "$BOLD" "$NC" > /dev/tty
    stty -echo < /dev/tty 2>/dev/null || true
    read -r pw < /dev/tty
    stty  echo < /dev/tty 2>/dev/null || true
    trap - INT TERM
    printf '\n' > /dev/tty
    [ -n "$pw" ] || die "empty password not allowed"
    printf '%s' "$pw"
}

detect_lan_ip() {
    # Best-effort LAN IP detection. Returns empty string on failure — caller
    # decides what to do (prompt the user, or die with a clear message).
    # One method per OS, no silent fallback between methods.
    case "$PULSE_OS" in
        linux)
            # `hostname -I` ships with the `hostname` package — present on every
            # apt-based distro Pulse v1 supports. First entry = primary LAN IP.
            hostname -I 2>/dev/null | awk '{print $1}'
            ;;
        macos)
            # Two-step: find the default-route iface, then ask ipconfig for its IPv4.
            iface="$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')"
            [ -n "$iface" ] && ipconfig getifaddr "$iface" 2>/dev/null
            ;;
    esac
}

prompt_line() {
    # prompt_line "Label" "default" -> echoes user input or default
    _pl_label="$1"; _pl_default="$2"
    if [ -n "$_pl_default" ]; then
        printf "  %b%s%b [%s]: " "$BOLD" "$_pl_label" "$NC" "$_pl_default" > /dev/tty
    else
        printf "  %b%s%b: " "$BOLD" "$_pl_label" "$NC" > /dev/tty
    fi
    read -r _pl_val < /dev/tty
    [ -n "$_pl_val" ] || _pl_val="$_pl_default"
    printf '%s' "$_pl_val"
}

read_env_value() {
    # Extract KEY=value from an env file. Empty output if file or key is missing.
    _re_file="$1"; _re_key="$2"
    [ -f "$_re_file" ] || return 0
    grep -E "^${_re_key}=" "$_re_file" 2>/dev/null | head -n 1 | cut -d= -f2-
}

prompt_network() {
    # Load existing values (upgrade path preserves these regardless of prompts).
    existing_api_host="$(read_env_value "$CONFIG_ROOT/client.env"   API_HOST)"
    existing_api_port="$(read_env_value "$CONFIG_ROOT/client.env"   API_PORT)"
    existing_web_host="$(read_env_value "$CONFIG_ROOT/frontend.env" WEB_HOST)"
    existing_web_port="$(read_env_value "$CONFIG_ROOT/frontend.env" WEB_PORT)"

    # Env-var overrides (scripted installs). If a value is already set via env,
    # it takes precedence over both existing and default.
    PULSE_API_HOST="${PULSE_API_HOST:-${existing_api_host:-0.0.0.0}}"
    PULSE_API_PORT="${PULSE_API_PORT:-${existing_api_port:-$PULSE_CLIENT_PORT}}"
    PULSE_WEB_HOST="${PULSE_WEB_HOST:-${existing_web_host:-0.0.0.0}}"
    PULSE_WEB_PORT="${PULSE_WEB_PORT:-${existing_web_port:-$PULSE_DASHBOARD_PORT}}"

    # PULSE_SERVER_HOST = the IP the dashboard will use to reach the client
    # (written into servers.json). Not derivable from .env — fresh every install
    # unless overridden or prompted.
    if [ -z "${PULSE_SERVER_HOST:-}" ]; then
        PULSE_SERVER_HOST_DETECTED="$(detect_lan_ip)"
    fi

    # Interactive path: only prompt on a fresh install (no existing env files)
    # and only if stdin is a TTY and PULSE_NO_INTERACT is off.
    needs_prompt=0
    [ "$PULSE_DASHBOARD_ONLY" = 0 ] && [ -z "$existing_api_host" ] && needs_prompt=1
    [ "$PULSE_CLIENT_ONLY"    = 0 ] && [ -z "$existing_web_host" ] && needs_prompt=1
    [ "$PULSE_CLIENT_ONLY"    = 0 ] && [ -z "${PULSE_SERVER_HOST:-}" ] && needs_prompt=1

    if [ "$needs_prompt" = 1 ] && [ "$PULSE_NO_INTERACT" != 1 ] && [ -r /dev/tty ] && [ -w /dev/tty ]; then
        printf "\n" > /dev/tty
        printf "  %b┌────────────────────────────────────────────────────────────────┐%b\n" "$BLUE" "$NC" > /dev/tty
        printf "  %b│  Network binding                                                │%b\n" "$BLUE" "$NC" > /dev/tty
        printf "  %b└────────────────────────────────────────────────────────────────┘%b\n" "$BLUE" "$NC" > /dev/tty
        printf "  Pulse services bind to these hosts. Default is %b0.0.0.0%b so phones\n" "$BOLD" "$NC" > /dev/tty
        printf "  and other machines on your network can reach the dashboard.\n" > /dev/tty
        printf "\n" > /dev/tty
        printf "  %b⚠  WARNING:%b 0.0.0.0 exposes Pulse on your LAN. You are protected\n" "$YELLOW" "$NC" > /dev/tty
        printf "     by a password, but if you only need local access, type %b127.0.0.1%b —\n" "$BOLD" "$NC" > /dev/tty
        printf "     in that case you won't be able to reach it from other devices.\n" > /dev/tty
        printf "\n" > /dev/tty

        if [ "$PULSE_CLIENT_ONLY" = 0 ] && [ -z "$existing_web_host" ]; then
            PULSE_WEB_HOST="$(prompt_line "Dashboard host"   "$PULSE_WEB_HOST")"
            PULSE_WEB_PORT="$(prompt_line "Dashboard port"   "$PULSE_WEB_PORT")"
        fi
        if [ "$PULSE_DASHBOARD_ONLY" = 0 ] && [ -z "$existing_api_host" ]; then
            PULSE_API_HOST="$(prompt_line "Client host   "   "$PULSE_API_HOST")"
            PULSE_API_PORT="$(prompt_line "Client port   "   "$PULSE_API_PORT")"
        fi
        if [ "$PULSE_CLIENT_ONLY" = 0 ] && [ -z "${PULSE_SERVER_HOST:-}" ]; then
            printf "\n" > /dev/tty
            printf "  %bServer URL%b is the IP the dashboard uses to reach the client —\n" "$BOLD" "$NC" > /dev/tty
            printf "  set to your LAN IP so phones/other machines can connect.\n" > /dev/tty
            PULSE_SERVER_HOST="$(prompt_line "Server URL    " "${PULSE_SERVER_HOST_DETECTED:-}")"
        fi
        printf "\n" > /dev/tty
    fi

    # Final validation — dashboard needs a server host to seed servers.json.
    if [ "$PULSE_CLIENT_ONLY" = 0 ] && [ -z "${PULSE_SERVER_HOST:-}" ]; then
        # Fresh install, dashboard-only or full install without detected IP and no env override.
        if [ -z "$existing_web_host" ]; then
            # Seed of servers.json is required and we have nothing to write.
            die "Server URL is required but LAN IP detection failed. Re-run with PULSE_SERVER_HOST=<your-lan-ip> (e.g., 192.168.1.20)."
        fi
        # Upgrade path: servers.json already exists and is preserved, so PULSE_SERVER_HOST is unused anyway.
    fi
}

seed_client_env() {
    [ "$PULSE_DASHBOARD_ONLY" = 1 ] && return 0
    env_file="$CONFIG_ROOT/client.env"
    if [ -f "$env_file" ] && grep -qE '^API_KEY=.+' "$env_file"; then
        log "client.env already exists — preserving"
        return 0
    fi
    api_key="$(hex_secret)"
    cat > "$env_file" <<EOF
COMPOSE_PROJECT_NAME=pulse
VERSION=$PULSE_INSTALLED_VERSION
API_HOST=$PULSE_API_HOST
API_PORT=$PULSE_API_PORT
API_KEY=$api_key
EOF
    chmod 600 "$env_file"
    # Also symlink to install dir so load.py fallback works in rare cases
    ln -sfn "$env_file" "$INSTALL_ROOT/client/.env" 2>/dev/null || true
    ok "wrote $env_file"
}

seed_frontend_env() {
    [ "$PULSE_CLIENT_ONLY" = 1 ] && return 0
    env_file="$CONFIG_ROOT/frontend.env"
    if [ -f "$env_file" ] && grep -qE '^AUTH_PASSWORD=.+' "$env_file"; then
        log "frontend.env already exists — preserving"
        return 0
    fi
    auth_password="$(prompt_password)"
    auth_secret="$(hex_secret)"
    cat > "$env_file" <<EOF
WEB_HOST=$PULSE_WEB_HOST
WEB_PORT=$PULSE_WEB_PORT
AUTH_PASSWORD=$auth_password
AUTH_JWT_SECRET=$auth_secret
AUTH_COOKIE_SECURE=false
EOF
    chmod 600 "$env_file"
    ln -sfn "$env_file" "$INSTALL_ROOT/frontend/.env" 2>/dev/null || true
    ok "wrote $env_file"
}

seed_servers_json() {
    [ "$PULSE_CLIENT_ONLY" = 1 ] && return 0
    servers_dir="$INSTALL_ROOT/frontend/data"
    mkdir -p "$servers_dir"
    servers_file="$servers_dir/servers.json"
    if [ -f "$servers_file" ]; then
        log "servers.json already exists — preserving"
        return 0
    fi
    if [ "$PULSE_DASHBOARD_ONLY" = 1 ]; then
        printf '{"servers":[]}\n' > "$servers_file"
        ok "wrote empty servers.json (dashboard-only install)"
        return 0
    fi
    # PULSE_SERVER_HOST is set by prompt_network() (interactive) or env var
    # (scripted). The dashboard-seed path is only reached on fresh installs,
    # so by the time we're here it must have a value.
    [ -n "${PULSE_SERVER_HOST:-}" ] || die "internal: PULSE_SERVER_HOST unset at seed_servers_json"
    api_key="$(grep -E '^API_KEY=' "$CONFIG_ROOT/client.env" | cut -d= -f2-)"
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    server_id="srv-$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || od -xN 16 /dev/urandom | head -1 | awk '{OFS="-"; print $2$3,$4,$5,$6,$7$8$9}')"
    cat > "$servers_file" <<EOF
{
  "servers": [
    {
      "id": "$server_id",
      "name": "localhost",
      "protocol": "http",
      "host": "$PULSE_SERVER_HOST",
      "port": $PULSE_API_PORT,
      "apiKey": "$api_key",
      "color": null,
      "createdAt": "$now"
    }
  ]
}
EOF
    ok "seeded servers.json pointing at local client"
}

# -----------------------------------------------------------------------------
# Service units
# -----------------------------------------------------------------------------
install_systemd_units() {
    units_dir="$HOME/.config/systemd/user"
    mkdir -p "$units_dir"
    [ "$PULSE_DASHBOARD_ONLY" = 0 ] && cp "$EXTRACTED/install/systemd/pulse-client.service.tmpl" "$units_dir/pulse-client.service"
    [ "$PULSE_CLIENT_ONLY"    = 0 ] && cp "$EXTRACTED/install/systemd/pulse.service.tmpl"        "$units_dir/pulse.service"
    systemctl --user daemon-reload
    ok "installed systemd user units in $units_dir"
}

substitute_plist() {
    # Only substitutes @@HOME@@. All runtime values (API_HOST, API_PORT, API_KEY,
    # AUTH_PASSWORD, AUTH_JWT_SECRET, ...) are sourced at service start from the
    # .env files — see the plist templates. This keeps secrets out of the plist
    # XML (no escaping headaches) and lets rotation happen without reinstall.
    sed -e "s|@@HOME@@|$HOME|g" "$1" > "$2"
}

install_launchd_units() {
    agents_dir="$HOME/Library/LaunchAgents"
    mkdir -p "$agents_dir"
    if [ "$PULSE_DASHBOARD_ONLY" = 0 ]; then
        substitute_plist "$EXTRACTED/install/launchd/sh.pulse.client.plist.tmpl"    "$agents_dir/sh.pulse.client.plist"
    fi
    if [ "$PULSE_CLIENT_ONLY" = 0 ]; then
        substitute_plist "$EXTRACTED/install/launchd/sh.pulse.dashboard.plist.tmpl" "$agents_dir/sh.pulse.dashboard.plist"
    fi
    ok "installed launchd plists in $agents_dir"
}

install_service_units() {
    status "installing service units"
    case "$PULSE_OS" in
        linux) install_systemd_units ;;
        macos) install_launchd_units ;;
    esac
}

enable_services() {
    [ "$PULSE_NO_START" = 1 ] && { log "skipping service start (PULSE_NO_START=1)"; return 0; }
    status "enabling services"
    case "$PULSE_OS" in
        linux)
            # loginctl enable-linger lets user services run without an active login
            if [ "$PULSE_IS_WSL" = 0 ]; then
                log "enabling user-service linger (may prompt for sudo password)"
                $PULSE_SUDO loginctl enable-linger "$USER" 2>/dev/null \
                    || warn "could not enable linger — services won't start at boot until you log in"
            fi
            units=""
            [ "$PULSE_DASHBOARD_ONLY" = 0 ] && units="$units pulse-client.service"
            [ "$PULSE_CLIENT_ONLY"    = 0 ] && units="$units pulse.service"
            # shellcheck disable=SC2086
            systemctl --user enable --now $units
            ;;
        macos)
            [ "$PULSE_DASHBOARD_ONLY" = 0 ] && launchctl load -w "$HOME/Library/LaunchAgents/sh.pulse.client.plist"    2>/dev/null || true
            [ "$PULSE_CLIENT_ONLY"    = 0 ] && launchctl load -w "$HOME/Library/LaunchAgents/sh.pulse.dashboard.plist" 2>/dev/null || true
            ;;
    esac
    ok "services enabled and started"
}

# -----------------------------------------------------------------------------
# Banner + prompts
# -----------------------------------------------------------------------------
greet() {
    cat <<'EOF'

  ██████╗ ██╗   ██╗██╗     ███████╗███████╗
  ██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
  ██████╔╝██║   ██║██║     ███████╗█████╗
  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝
  ██║     ╚██████╔╝███████╗███████║███████╗
  ╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝
  Keep your terminals alive.

EOF
}

print_success() {
    printf "\n"
    printf "%b╔════════════════════════════════════════════════════════════════════╗%b\n" "$GREEN" "$NC"
    printf "%b║  Pulse %s installed                                            ║%b\n" "$GREEN" "$PULSE_INSTALLED_VERSION" "$NC"
    printf "%b╚════════════════════════════════════════════════════════════════════╝%b\n" "$GREEN" "$NC"
    printf "\n"
    if [ "$PULSE_CLIENT_ONLY" = 0 ]; then
        # If bound to 0.0.0.0 / ::, localhost works locally and the LAN IP works from other devices.
        # If bound to 127.0.0.1, only localhost works.
        dash_port="${PULSE_WEB_PORT:-$PULSE_DASHBOARD_PORT}"
        printf "  %bDashboard:%b http://localhost:%s\n" "$BOLD" "$NC" "$dash_port"
        case "${PULSE_WEB_HOST:-}" in
            0.0.0.0|::|'')
                if [ -n "${PULSE_SERVER_HOST:-}" ] && [ "${PULSE_SERVER_HOST:-}" != "127.0.0.1" ] && [ "${PULSE_SERVER_HOST:-}" != "localhost" ]; then
                    printf "             http://%s:%s  (from phone/LAN)\n" "$PULSE_SERVER_HOST" "$dash_port"
                fi
                ;;
        esac
    fi
    if [ "$PULSE_DASHBOARD_ONLY" = 0 ]; then
        api_port="${PULSE_API_PORT:-$PULSE_CLIENT_PORT}"
        api_reach="${PULSE_SERVER_HOST:-127.0.0.1}"
        printf "  %bClient API:%b http://%s:%s\n" "$BOLD" "$NC" "$api_reach" "$api_port"
    fi
    printf "\n"
    printf "  %bCommands:%b\n" "$BOLD" "$NC"
    printf "    %bpulse status%b                service health (client + dashboard)\n"           "$DIM" "$NC"
    printf "    %bpulse start%b / %bstop%b / %brestart%b     control services\n"                 "$DIM" "$NC" "$DIM" "$NC" "$DIM" "$NC"
    printf "    %bpulse logs client -f%b        follow client logs (or 'dashboard')\n"           "$DIM" "$NC"
    printf "    %bpulse open%b                  open the dashboard in the browser\n"             "$DIM" "$NC"
    printf "    %bpulse upgrade%b               fetch the latest release and reinstall\n"        "$DIM" "$NC"
    printf "    %bpulse uninstall%b             remove everything\n"                             "$DIM" "$NC"
    printf "    %bpulse keys show%b / %bregen%b      show or rotate the client API_KEY\n"        "$DIM" "$NC" "$DIM" "$NC"
    printf "    %bpulse config password%b       change the dashboard password\n"                 "$DIM" "$NC"
    printf "    %bpulse config ports%b          show / change client + dashboard ports\n"        "$DIM" "$NC"
    printf "    %bpulse config host%b           show / change bind hosts (0.0.0.0 for LAN)\n"    "$DIM" "$NC"
    printf "    %bpulse config secure on%b      AUTH_COOKIE_SECURE=true (HTTPS / reverse proxy)\n" "$DIM" "$NC"
    printf "    %bpulse config rotate-jwt%b     regenerate AUTH_JWT_SECRET (kicks every login)\n"  "$DIM" "$NC"
    printf "    %bpulse config paths%b          print install / config / logs paths\n"          "$DIM" "$NC"
    printf "    %bpulse config open %b<dir>     open a pulse dir in the file manager\n"         "$DIM" "$NC"
    printf "    %bpulse config edit %b<target>  open a .env file in \$EDITOR\n"                  "$DIM" "$NC"
    printf "\n"
    printf "  Run %bpulse help%b anytime for the full command list and options.\n" "$BOLD" "$NC"
    printf "\n"
    # If ~/.local/bin is already on PATH, nothing to do.
    case ":$PATH:" in
        *":$BIN_ROOT:"*) return 0 ;;
    esac
    # Try to add to the active shell's rc file; fall back to manual instructions.
    case "$(basename "${SHELL:-}")" in
        zsh)  rc_file="$HOME/.zshrc"  ;;
        bash) rc_file="$HOME/.bashrc" ;;
        *)    rc_file=""              ;;
    esac
    added=0
    if [ -n "$rc_file" ] && [ -w "$(dirname "$rc_file")" ]; then
        if ! grep -q '\.local/bin' "$rc_file" 2>/dev/null; then
            # shellcheck disable=SC2016
            printf '\n# Added by Pulse installer\nexport PATH="$HOME/.local/bin:$PATH"\n' >> "$rc_file"
            added=1
        fi
    fi
    if [ "$added" = 1 ]; then
        printf "  %b✓%b Added %s to PATH in %s. Restart your shell or run: %bsource %s%b\n\n" \
            "$GREEN" "$NC" "$BIN_ROOT" "$rc_file" "$BOLD" "$rc_file" "$NC"
    else
        printf "  %b!%b Add %b%s%b to your PATH manually:\n"      "$YELLOW" "$NC" "$BOLD" "$BIN_ROOT" "$NC"
        printf "      export PATH=\"%s:\$PATH\"\n\n" "$BIN_ROOT"
    fi
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
    greet
    need_cmd curl || die "curl is required"
    need_cmd tar  || die "tar is required"

    detect_platform
    setup_sudo

    if [ "$PULSE_CLIENT_ONLY" = 1 ] && [ "$PULSE_DASHBOARD_ONLY" = 1 ]; then
        die "PULSE_CLIENT_ONLY and PULSE_DASHBOARD_ONLY cannot both be set"
    fi

    TEMP_DIR=$(mktemp -d)
    trap 'rm -rf "$TEMP_DIR"' EXIT

    ensure_runtime_deps
    download_and_extract
    install_files
    prompt_network
    seed_client_env
    seed_frontend_env
    seed_servers_json
    install_service_units
    enable_services
    print_success
}

main "$@"
