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

# True when something is currently listening on the local TCP port. Uses bash's
# built-in /dev/tcp so it has zero external dependencies — and, because it
# mirrors exactly what uvicorn/next do at bind time, it's the source of truth
# for "is this port available?". PID enumeration tools (lsof/ss/fuser) can lag
# during process teardown and report no holder while the socket is still bound.
_pulse_port_in_use() {
    port="$1"
    (exec 3<>/dev/tcp/127.0.0.1/"$port") 2>/dev/null
}

# List PIDs listening on a TCP port (best effort, for display). Tries lsof,
# then ss, then fuser. Empty output is fine — caller falls back to fuser -k.
_pulse_pids_on_port() {
    port="$1"
    if pulse_need_cmd lsof; then
        lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tr '\n' ' '
    elif pulse_need_cmd ss; then
        ss -H -lptn "sport = :$port" 2>/dev/null \
            | grep -oE 'pid=[0-9]+' \
            | cut -d= -f2 \
            | sort -u \
            | tr '\n' ' '
    elif pulse_need_cmd fuser; then
        fuser -n tcp "$port" 2>/dev/null | tr -s ' \t' '\n' | grep -E '^[0-9]+$' | sort -u | tr '\n' ' '
    fi
}

# Check if a TCP port is in use; if so, list the process(es) and ask the user
# whether to kill. Default answer is yes (Enter = Y). Aborts on "no".
# Usage: pulse_check_port <port> [<service-label>]
pulse_check_port() {
    port="$1"
    label="${2:-process}"

    _pulse_port_in_use "$port" || return 0

    pids="$(_pulse_pids_on_port "$port" | tr -s ' ')"
    pids="${pids# }"
    pids="${pids% }"

    if [ -n "$pids" ]; then
        pulse_warn "port $port already in use by:"
        for pid in $pids; do
            info="$(ps -o pid=,user=,etime=,args= -p "$pid" 2>/dev/null | sed 's/^[[:space:]]*//')"
            if [ -n "$info" ]; then
                printf "    %s\n" "$info"
            else
                printf "    pid %s (no longer running?)\n" "$pid"
            fi
        done
    else
        pulse_warn "port $port already in use (process owner unknown — may need 'sudo lsof -i:$port' to identify)"
    fi

    if [ ! -e /dev/tty ]; then
        pulse_die "port $port in use and no TTY available to confirm. Free it manually and rerun."
    fi

    printf "%bKill %s on port %s and continue? [Y/n]%b " "$PULSE_YELLOW" "$label" "$port" "$PULSE_NC"
    if ! read -r answer </dev/tty; then
        pulse_die "could not read from /dev/tty — aborting."
    fi
    case "$answer" in
        n|N|no|NO|No) pulse_die "aborted — port $port still in use." ;;
    esac

    for pid in $pids; do
        kill "$pid" 2>/dev/null || true
    done
    if pulse_need_cmd fuser; then
        fuser -k -TERM -n tcp "$port" >/dev/null 2>&1 || true
    fi

    i=0
    while [ "$i" -lt 20 ]; do
        sleep 0.25
        if ! _pulse_port_in_use "$port"; then
            pulse_ok "port $port freed."
            return 0
        fi
        i=$((i + 1))
    done

    pulse_warn "process didn't exit on TERM — sending KILL"
    survivors="$(_pulse_pids_on_port "$port" | tr -s ' ')"
    survivors="${survivors# }"
    survivors="${survivors% }"
    for pid in $survivors; do
        kill -9 "$pid" 2>/dev/null || true
    done
    if pulse_need_cmd fuser; then
        fuser -k -KILL -n tcp "$port" >/dev/null 2>&1 || true
    fi

    i=0
    while [ "$i" -lt 8 ]; do
        sleep 0.25
        if ! _pulse_port_in_use "$port"; then
            pulse_ok "port $port freed."
            return 0
        fi
        i=$((i + 1))
    done

    pulse_die "could not free port $port."
}
