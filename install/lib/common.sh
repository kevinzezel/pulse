# Pulse — common helpers (POSIX sh)
# Sourced by install.sh, pulse CLI, and dev start.sh scripts.
# Never executed directly.

# Colors (disabled when stdout is not a terminal, e.g. piped to file)
if [ -t 1 ]; then
    PULSE_YELLOW='\033[1;33m'
    PULSE_GREEN='\033[1;32m'
    PULSE_RED='\033[1;31m'
    PULSE_BLUE='\033[1;34m'
    PULSE_BOLD='\033[1m'
    PULSE_DIM='\033[2m'
    PULSE_NC='\033[0m'
else
    PULSE_YELLOW=''; PULSE_GREEN=''; PULSE_RED=''
    PULSE_BLUE=''; PULSE_BOLD=''; PULSE_DIM=''; PULSE_NC=''
fi

# Log prefix tag — caller overrides via PULSE_LOG_TAG before sourcing
PULSE_LOG_TAG="${PULSE_LOG_TAG:-pulse}"

pulse_log()    { printf "%b[%s]%b %s\n" "$PULSE_GREEN"  "$PULSE_LOG_TAG" "$PULSE_NC" "$*"; }
pulse_warn()   { printf "%b[%s]%b %s\n" "$PULSE_YELLOW" "$PULSE_LOG_TAG" "$PULSE_NC" "$*"; }
pulse_err()    { printf "%b[%s]%b %s\n" "$PULSE_RED"    "$PULSE_LOG_TAG" "$PULSE_NC" "$*" 1>&2; }
pulse_status() { printf "%b▸%b %s\n"    "$PULSE_BLUE"   "$PULSE_NC" "$*"; }
pulse_ok()     { printf "%b✓%b %s\n"    "$PULSE_GREEN"  "$PULSE_NC" "$*"; }
pulse_die()    { pulse_err "$*"; exit 1; }

# Command existence check (POSIX — never use `which`)
pulse_need_cmd() { command -v "$1" >/dev/null 2>&1; }

# Resolve privilege escalation tool (Tailscale pattern)
# Sets PULSE_SUDO to "", "sudo", or "doas" — dies if none work and not root.
pulse_setup_sudo() {
    if [ "$(id -u)" = 0 ]; then
        PULSE_SUDO=""
    elif pulse_need_cmd sudo; then
        PULSE_SUDO="sudo"
    elif pulse_need_cmd doas; then
        PULSE_SUDO="doas"
    else
        pulse_die "No sudo or doas available — rerun as root or install one of them."
    fi
}

# Generate a cryptographically random hex string (32 bytes = 64 hex chars).
# Prefers openssl; falls back to /dev/urandom.
pulse_hex_secret() {
    if pulse_need_cmd openssl; then
        openssl rand -hex 32
    elif [ -r /dev/urandom ]; then
        head -c 48 /dev/urandom | base64 | tr -d '\n' | head -c 64
        printf '\n'
    else
        pulse_die "No openssl or /dev/urandom available to generate secret."
    fi
}

# Ensure a key=value line exists in a .env file. Creates the file if missing,
# updates in place if key exists, appends otherwise.
pulse_env_set() {
    env_file="$1"
    env_key="$2"
    env_value="$3"
    if [ ! -f "$env_file" ]; then
        printf '%s=%s\n' "$env_key" "$env_value" > "$env_file"
        return 0
    fi
    if grep -qE "^${env_key}=" "$env_file"; then
        # sed -i is not portable (BSD vs GNU); use temp file
        tmp="${env_file}.tmp.$$"
        awk -v k="$env_key" -v v="$env_value" '
            BEGIN { updated = 0 }
            $0 ~ "^"k"=" { print k"="v; updated = 1; next }
            { print }
            END { if (!updated) print k"="v }
        ' "$env_file" > "$tmp" && mv "$tmp" "$env_file"
    else
        printf '%s=%s\n' "$env_key" "$env_value" >> "$env_file"
    fi
}

# Read a key=value from a .env file; prints value to stdout.
# Returns non-zero if not found.
pulse_env_get() {
    env_file="$1"
    env_key="$2"
    [ -f "$env_file" ] || return 1
    val="$(grep -E "^${env_key}=" "$env_file" | head -n1 | cut -d= -f2-)"
    [ -n "$val" ] || return 1
    printf '%s' "$val"
}
