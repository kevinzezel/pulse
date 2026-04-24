#!/usr/bin/env bash
# Pulse client dev runner.
# Installs missing system deps via apt/brew on first run, generates API_KEY if
# missing, and starts uvicorn. For production distribution see install/install.sh.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
PULSE_LOG_TAG="client"
. "$REPO_ROOT/install/lib/common.sh"
# shellcheck disable=SC1091
. "$REPO_ROOT/install/lib/bootstrap.sh"

RELOAD=""
INSTALL_MODE="auto"
REGEN_KEY=0
SHOW_KEY=0
CLI_HOST=""
CLI_PORT=""

for arg in "$@"; do
    case "$arg" in
        --host=*) CLI_HOST="${arg#*=}" ;;
        --port=*) CLI_PORT="${arg#*=}" ;;
        --reload) RELOAD="--reload" ;;
        --install-only) INSTALL_MODE="only" ;;
        --no-install) INSTALL_MODE="skip" ;;
        --regen-key) REGEN_KEY=1 ;;
        --show-key) SHOW_KEY=1 ;;
        -h|--help)
            cat <<EOF
Usage: ./start.sh [--host=<host>] [--port=<port>] [--reload]
                  [--install-only | --no-install]
                  [--regen-key] [--show-key]

Env (required, read from client/.env):
  API_HOST    host for uvicorn bind
  API_PORT    uvicorn port
  API_KEY     auth key (auto-generated on first run)

CLI flags --host and --port override .env values.

Automatically installs missing deps via apt (Debian/Ubuntu/WSL) or brew (macOS).

.env management:
  - First run: a fresh .env is written with a random API_KEY.
  - --regen-key overwrites .env with a new API_KEY.
  - --show-key prints the current API_KEY and exits.
EOF
            exit 0
            ;;
    esac
done

print_key_banner() {
    key="$1"
    label="$2"
    printf "\n%b════════════════════════════════════════════════════════════════════════%b\n" "$PULSE_YELLOW" "$PULSE_NC"
    printf "%b  %s:%b %b%s%b\n" "$PULSE_BOLD" "$label" "$PULSE_NC" "$PULSE_YELLOW" "$key" "$PULSE_NC"
    printf "%b  Register this key in the frontend (Settings → Servers) before creating sessions.%b\n" "$PULSE_BOLD" "$PULSE_NC"
    printf "%b════════════════════════════════════════════════════════════════════════%b\n\n" "$PULSE_YELLOW" "$PULSE_NC"
}

write_env_with_key() {
    key="$1"
    cat > .env <<EOF
COMPOSE_PROJECT_NAME=pulse
VERSION=1.4.2
API_HOST=$API_HOST
API_PORT=$API_PORT

API_KEY=$key
EOF
}

ensure_env() {
    needs_gen=0
    if [ "$REGEN_KEY" -eq 1 ]; then
        needs_gen=1
    elif [ ! -f ".env" ]; then
        needs_gen=1
    elif ! grep -qE '^API_KEY=.+' .env; then
        needs_gen=1
    fi

    if [ "$needs_gen" -eq 1 ]; then
        key="$(pulse_hex_secret)"
        write_env_with_key "$key"
        print_key_banner "$key" "NEW API_KEY GENERATED"
    else
        key="$(pulse_env_get .env API_KEY)"
        print_key_banner "$key" "API_KEY"
    fi
}

validate_runtime() {
    fatal=0
    pulse_need_cmd python3  || { pulse_err "python3 not on PATH. Install Python 3.10+."; fatal=1; }
    if pulse_need_cmd python3 && ! python3 -c "import venv" >/dev/null 2>&1; then
        pulse_err "Python venv module unavailable. Install python3-venv."
        fatal=1
    fi
    pulse_need_cmd tmux     || { pulse_err "tmux not on PATH."; fatal=1; }
    pulse_need_cmd openssl  || { pulse_err "openssl not on PATH."; fatal=1; }
    [ "$fatal" -eq 1 ] && exit 1
    return 0
}

if [ "$SHOW_KEY" -eq 1 ]; then
    if k="$(pulse_env_get .env API_KEY)"; then
        print_key_banner "$k" "CURRENT API_KEY"
        exit 0
    fi
    pulse_die "client/.env not found or missing API_KEY. Run without --show-key to generate."
fi

if [ "$INSTALL_MODE" != "skip" ]; then
    pulse_detect_platform
    pulse_setup_sudo
    pulse_ensure_runtime_deps
fi
validate_runtime

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    pulse_log ".env missing — copying from .env.example"
    cp .env.example .env
fi
if [ -f ".env" ]; then
    # shellcheck disable=SC1091
    . .env
fi

[ -n "$CLI_HOST" ] && API_HOST="$CLI_HOST"
[ -n "$CLI_PORT" ] && API_PORT="$CLI_PORT"

: "${API_HOST:?API_HOST env var required (set in client/.env)}"
: "${API_PORT:?API_PORT env var required (set in client/.env)}"

ensure_env
[ "$INSTALL_MODE" = "only" ] && exit 0

pulse_check_port "$API_PORT" "client"

pulse_need_cmd uv || pulse_die "uv not on PATH. Run without --no-install, or install manually: curl -LsSf https://astral.sh/uv/install.sh | sh"

VENV="$SCRIPT_DIR/.venv"
STAMP="$VENV/.pulse-requirements.stamp"
py_version="$(tr -d '[:space:]' < "$SCRIPT_DIR/.python-version")"

if [ ! -d "$VENV" ]; then
    pulse_log "creating .venv at $VENV (python $py_version) via uv"
    uv venv "$VENV" --python "$py_version" --quiet
fi
if [ ! -f "$STAMP" ] || [ "$SCRIPT_DIR/requirements.txt" -nt "$STAMP" ]; then
    pulse_log "installing python deps into .venv via uv pip"
    uv pip install --python "$VENV/bin/python" --quiet -r "$SCRIPT_DIR/requirements.txt"
    touch "$STAMP"
fi

cd src
if [ "${TLS_ENABLED:-false}" = "true" ]; then
    : "${TLS_CERT_PATH:?TLS_ENABLED=true but TLS_CERT_PATH unset (run: pulse config tls on)}"
    : "${TLS_KEY_PATH:?TLS_ENABLED=true but TLS_KEY_PATH unset (run: pulse config tls on)}"
    [ -r "$TLS_CERT_PATH" ] || pulse_die "cert not readable: $TLS_CERT_PATH (run: pulse config tls on)"
    [ -r "$TLS_KEY_PATH"  ] || pulse_die "key not readable: $TLS_KEY_PATH (run: pulse config tls on)"
    pulse_log "uvicorn at https://$API_HOST:$API_PORT (TLS)"
    exec "$VENV/bin/uvicorn" service:app --host "$API_HOST" --port "$API_PORT" \
        --ssl-keyfile "$TLS_KEY_PATH" --ssl-certfile "$TLS_CERT_PATH" $RELOAD
fi

pulse_log "uvicorn at http://$API_HOST:$API_PORT"
exec "$VENV/bin/uvicorn" service:app --host "$API_HOST" --port "$API_PORT" $RELOAD
