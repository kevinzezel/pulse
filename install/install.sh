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
    node_ok && return 0
    case "$PULSE_PM" in
        apt)
            log "installing Node.js 20 via NodeSource"
            curl -fsSL https://deb.nodesource.com/setup_20.x | $PULSE_SUDO -E bash -
            $PULSE_SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs
            ;;
        brew)
            brew install node@20
            brew link --overwrite --force node@20 2>/dev/null || true
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
            systemctl --user stop pulse.service pulse-client.service 2>/dev/null || true
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
        rm -rf "$INSTALL_ROOT/client"
        cp -R "$EXTRACTED/client" "$INSTALL_ROOT/client"
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
API_HOST=127.0.0.1
API_PORT=$PULSE_CLIENT_PORT
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
WEB_HOST=127.0.0.1
WEB_PORT=$PULSE_DASHBOARD_PORT
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
    api_key="$(grep -E '^API_KEY=' "$CONFIG_ROOT/client.env" | cut -d= -f2-)"
    now="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    cat > "$servers_file" <<EOF
{
  "servers": [
    {
      "id": "localhost",
      "name": "localhost",
      "protocol": "http",
      "host": "127.0.0.1",
      "port": $PULSE_CLIENT_PORT,
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
        printf "  %bDashboard:%b http://localhost:%s\n" "$BOLD" "$NC" "$PULSE_DASHBOARD_PORT"
    fi
    if [ "$PULSE_DASHBOARD_ONLY" = 0 ]; then
        printf "  %bClient API:%b http://127.0.0.1:%s\n" "$BOLD" "$NC" "$PULSE_CLIENT_PORT"
    fi
    printf "\n"
    printf "  %bCommands:%b\n" "$BOLD" "$NC"
    printf "    %bpulse status%b           — show service status\n"  "$DIM" "$NC"
    printf "    %bpulse logs client%b      — tail client logs\n"     "$DIM" "$NC"
    printf "    %bpulse open%b             — open dashboard in browser\n" "$DIM" "$NC"
    printf "    %bpulse upgrade%b          — upgrade to latest\n"    "$DIM" "$NC"
    printf "    %bpulse uninstall%b        — remove everything\n"    "$DIM" "$NC"
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
    seed_client_env
    seed_frontend_env
    seed_servers_json
    install_service_units
    enable_services
    print_success
}

main "$@"
