# Pulse — bootstrap helpers (POSIX sh)
# OS detection + system package installation.
# Requires install/lib/common.sh to be sourced first.

# Detects the current OS and package manager.
# Sets:
#   PULSE_OS        — "linux" | "macos"
#   PULSE_ARCH      — "amd64" | "arm64"
#   PULSE_PM        — "apt" | "brew"
#   PULSE_IS_WSL    — "1" | "0"
pulse_detect_platform() {
    case "$(uname -s)" in
        Linux)
            PULSE_OS=linux
            case "$(uname -r)" in
                *icrosoft*WSL2*|*icrosoft*wsl2*) PULSE_IS_WSL=1 ;;
                *)                                PULSE_IS_WSL=0 ;;
            esac
            if pulse_need_cmd apt-get; then
                PULSE_PM=apt
            else
                pulse_die "Unsupported Linux distro: Pulse v1 only supports apt-based systems (Debian/Ubuntu/WSL Ubuntu). Open an issue to request Fedora/Arch support."
            fi
            ;;
        Darwin)
            PULSE_OS=macos
            PULSE_IS_WSL=0
            if ! pulse_need_cmd brew; then
                pulse_die "Homebrew not found. Install it from https://brew.sh first, then rerun."
            fi
            PULSE_PM=brew
            ;;
        *)
            pulse_die "Unsupported OS: $(uname -s)"
            ;;
    esac

    case "$(uname -m)" in
        x86_64|amd64)       PULSE_ARCH=amd64 ;;
        aarch64|arm64)      PULSE_ARCH=arm64 ;;
        *) pulse_die "Unsupported architecture: $(uname -m)" ;;
    esac
}

# Install system packages via the detected package manager.
# Args: package names (space-separated).
# Assumes pulse_setup_sudo has been called.
pulse_install_packages() {
    [ "$#" -eq 0 ] && return 0
    case "$PULSE_PM" in
        apt)
            $PULSE_SUDO apt-get update -qq
            $PULSE_SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "$@"
            ;;
        brew)
            brew install "$@"
            ;;
        *)
            pulse_die "pulse_install_packages: unknown package manager '$PULSE_PM'"
            ;;
    esac
}

# Install uv (Astral's Python package manager) if not already available.
pulse_ensure_uv() {
    if pulse_need_cmd uv; then return 0; fi
    if [ -x "$HOME/.local/bin/uv" ]; then
        PATH="$HOME/.local/bin:$PATH"
        export PATH
        return 0
    fi
    pulse_log "installing uv from astral.sh"
    curl -LsSf https://astral.sh/uv/install.sh | sh
    PATH="$HOME/.local/bin:$PATH"
    export PATH
    pulse_need_cmd uv || pulse_die "uv install reported success but uv is not on PATH"
}

# Check whether installed Node.js satisfies the minimum version (18.17+).
_pulse_node_ok() {
    pulse_need_cmd node || return 1
    v="$(node -v)"; v="${v#v}"
    major="${v%%.*}"; rest="${v#*.}"; minor="${rest%%.*}"
    if [ "$major" -gt 18 ]; then return 0; fi
    if [ "$major" -eq 18 ] && [ "$minor" -ge 17 ]; then return 0; fi
    return 1
}

# Install Node.js 20 (via NodeSource on apt, brew on macOS) if missing or too old.
pulse_ensure_node() {
    _pulse_node_ok && return 0
    case "$PULSE_PM" in
        apt)
            pulse_log "installing Node.js 20 via NodeSource"
            curl -fsSL https://deb.nodesource.com/setup_20.x | $PULSE_SUDO -E bash -
            $PULSE_SUDO DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs
            ;;
        brew)
            brew install node@20
            brew link --overwrite --force node@20 2>/dev/null || true
            ;;
    esac
    _pulse_node_ok || pulse_die "Node.js install reported success but 'node' is not 18.17+"
}

# Install all runtime deps required by Pulse (client + frontend).
# Call this after pulse_detect_platform + pulse_setup_sudo.
pulse_ensure_runtime_deps() {
    need=""
    pulse_need_cmd tmux     || need="$need tmux"
    pulse_need_cmd python3  || need="$need python3"
    pulse_need_cmd curl     || need="$need curl"
    pulse_need_cmd openssl  || need="$need openssl"
    pulse_need_cmd tar      || need="$need tar"
    if [ "$PULSE_PM" = apt ] && pulse_need_cmd python3 && ! python3 -c "import venv" >/dev/null 2>&1; then
        need="$need python3-venv"
    fi
    # trim leading space + split
    need="$(printf '%s' "$need" | sed 's/^ *//')"
    if [ -n "$need" ]; then
        pulse_log "installing system packages: $need"
        # shellcheck disable=SC2086
        pulse_install_packages $need
    fi
    pulse_ensure_uv
    pulse_ensure_node
}
