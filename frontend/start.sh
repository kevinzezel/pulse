#!/usr/bin/env bash
# Pulse frontend (dashboard) dev runner.
# Installs missing Node.js / npm deps on first run, auto-generates AUTH_JWT_SECRET,
# and starts Next.js in dev or prod mode.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck disable=SC1091
PULSE_LOG_TAG="frontend"
. "$REPO_ROOT/install/lib/common.sh"
# shellcheck disable=SC1091
. "$REPO_ROOT/install/lib/bootstrap.sh"

MODE="dev"
INSTALL_MODE="auto"
CLI_HOST=""
CLI_PORT=""

for arg in "$@"; do
    case "$arg" in
        --prod|--production) MODE="prod" ;;
        --dev) MODE="dev" ;;
        --host=*) CLI_HOST="${arg#*=}" ;;
        --port=*) CLI_PORT="${arg#*=}" ;;
        --install-only) INSTALL_MODE="only" ;;
        --no-install) INSTALL_MODE="skip" ;;
        -h|--help)
            cat <<EOF
Usage: ./start.sh [--dev | --prod] [--host=<host>] [--port=<port>]
                  [--install-only | --no-install]

Env (required, read from frontend/.env):
  WEB_HOST            host for next bind
  WEB_PORT            port for next
  AUTH_PASSWORD       shared login password (NOT 'change-me')
  AUTH_JWT_SECRET     HS256 JWT secret (auto-generated if missing/placeholder)
  AUTH_COOKIE_SECURE  'true' in prod (HTTPS); 'false' in local dev

CLI flags --host and --port override .env values.

Automatically installs Node.js 20 via apt (Debian/Ubuntu/WSL) or brew (macOS)
when node is missing or < 18.17.
EOF
            exit 0
            ;;
    esac
done

validate_runtime() {
    fatal=0
    if ! pulse_need_cmd node; then
        pulse_err "node not on PATH. Install Node.js 18.17+ and rerun."
        fatal=1
    fi
    pulse_need_cmd npm || { pulse_err "npm not on PATH (comes with Node.js)."; fatal=1; }
    [ "$fatal" -eq 1 ] && exit 1
    return 0
}

install_frontend_deps() {
    if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
        if [ -f "package-lock.json" ]; then
            pulse_log "npm ci"
            npm ci --loglevel=error
        else
            pulse_log "npm install"
            npm install --loglevel=error
        fi
    fi
}

ensure_auth_secret() {
    current="$(pulse_env_get .env AUTH_JWT_SECRET 2>/dev/null || true)"
    if [ -z "$current" ] || [ "$current" = "change-me" ]; then
        new="$(pulse_hex_secret)"
        pulse_env_set .env AUTH_JWT_SECRET "$new"
        export AUTH_JWT_SECRET="$new"
        pulse_log "AUTH_JWT_SECRET generated automatically."
    fi
}

if [ "$INSTALL_MODE" != "skip" ]; then
    pulse_detect_platform
    pulse_setup_sudo
    pulse_need_cmd curl || pulse_install_packages curl
    pulse_ensure_node
    install_frontend_deps
fi
validate_runtime

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
    pulse_log ".env missing — copying from .env.example"
    cp .env.example .env
fi
if [ -f ".env" ]; then
    set -a
    # shellcheck disable=SC1091
    . .env
    set +a
fi

ensure_auth_secret

[ -n "$CLI_HOST" ] && WEB_HOST="$CLI_HOST"
[ -n "$CLI_PORT" ] && WEB_PORT="$CLI_PORT"

: "${WEB_HOST:?WEB_HOST env var required (set in frontend/.env)}"
: "${WEB_PORT:?WEB_PORT env var required (set in frontend/.env)}"
: "${AUTH_PASSWORD:?AUTH_PASSWORD env var required (set in frontend/.env)}"
: "${AUTH_JWT_SECRET:?AUTH_JWT_SECRET env var required (set in frontend/.env)}"

if [ "$AUTH_PASSWORD" = "change-me" ]; then
    pulse_die "AUTH_PASSWORD is still 'change-me' — set a real password in frontend/.env"
fi

[ "$INSTALL_MODE" = "only" ] && exit 0

pulse_check_port "$WEB_PORT" "frontend"

if [ "$MODE" = "prod" ]; then
    scheme="http"
    [ "${TLS_ENABLED:-false}" = "true" ] && scheme="https"
    pulse_log "build + start at $scheme://$WEB_HOST:$WEB_PORT"
    npm run build
    # server.js handles HTTP/HTTPS branching from TLS_ENABLED. Keeping the
    # same entrypoint regardless of mode means systemd/launchd templates
    # don't need to know about TLS.
    exec node server.js
fi

# Dev mode stays on plain `next dev` even when TLS_ENABLED=true — Next dev's
# HMR doesn't combine cleanly with our custom HTTPS server. Run with --prod
# locally if you need to test the HTTPS path.
pulse_log "dev at http://$WEB_HOST:$WEB_PORT"
exec npx next dev -p "$WEB_PORT" -H "$WEB_HOST"
