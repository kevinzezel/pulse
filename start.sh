#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$SCRIPT_DIR/client"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

cleanup() {
    echo ""
    echo "Shutting down..."
    [ -n "$CLIENT_PID" ] && kill "$CLIENT_PID" 2>/dev/null || true
    [ -n "$FRONTEND_PID" ] && kill "$FRONTEND_PID" 2>/dev/null || true
    wait 2>/dev/null || true
    echo "Done."
}
trap cleanup EXIT INT TERM

GREEN='\033[1;32m'
NC='\033[0m'

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -z "$LAN_IP" ] && LAN_IP="localhost"

if [ ! -f "$CLIENT_DIR/.env" ] && [ -f "$CLIENT_DIR/.env.example" ]; then
    cp "$CLIENT_DIR/.env.example" "$CLIENT_DIR/.env"
fi
if [ ! -f "$FRONTEND_DIR/.env" ] && [ -f "$FRONTEND_DIR/.env.example" ]; then
    cp "$FRONTEND_DIR/.env.example" "$FRONTEND_DIR/.env"
fi
if [ -f "$CLIENT_DIR/.env" ]; then
    source "$CLIENT_DIR/.env"
fi
if [ -f "$FRONTEND_DIR/.env" ]; then
    set -a; source "$FRONTEND_DIR/.env"; set +a
fi

: "${API_PORT:?API_PORT env var required (set in client/.env)}"
: "${WEB_PORT:?WEB_PORT env var required (set in frontend/.env)}"

echo "Starting client..."
"$CLIENT_DIR/start.sh" &
CLIENT_PID=$!
echo "Client PID: $CLIENT_PID"

echo "Starting frontend..."
"$FRONTEND_DIR/start.sh" &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
printf "%b=========================================%b\n" "$GREEN" "$NC"
printf "  Client:   http://%s:%s\n" "$LAN_IP" "$API_PORT"
printf "  Frontend: http://localhost:%s\n" "$WEB_PORT"
printf "  Press Ctrl+C to stop\n"
printf "%b=========================================%b\n" "$GREEN" "$NC"
echo ""

wait
