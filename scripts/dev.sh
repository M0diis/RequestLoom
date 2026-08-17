#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOG_DIR="$ROOT_DIR/.dev-logs"
PID_DIR="$ROOT_DIR/.dev-pids"

BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/backend.log"
FRONTEND_LOG="$LOG_DIR/frontend.log"

BACKEND_PORT="${BACKEND_PORT:-5056}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"

export PATH="${DOTNET_ROOT:-$HOME/.dotnet}:$PATH"
export DOTNET_ROOT="${DOTNET_ROOT:-$HOME/.dotnet}"
export DOTNET_SYSTEM_GLOBALIZATION_INVARIANT="${DOTNET_SYSTEM_GLOBALIZATION_INVARIANT:-1}"

usage() {
  cat <<EOF
Usage: $(basename "$0") <start|stop|restart|status>

Commands:
  start    Start backend and frontend (kills conflicting ports when needed)
  stop     Stop backend and frontend
  restart  Stop then start both services
  status   Show PID/port status

Environment variables:
  BACKEND_PORT   Backend port (default: 5056)
  FRONTEND_PORT  Frontend Vite port (default: 5173)
  DOTNET_ROOT    Path to .NET installation (default: \$HOME/.dotnet)
EOF
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

pid_is_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

read_pid() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 0
  tr -d '[:space:]' < "$pid_file"
}

port_in_use() {
  local port="$1"

  if command_exists fuser; then
    fuser "${port}/tcp" >/dev/null 2>&1
    return $?
  fi

  if command_exists lsof; then
    lsof -ti TCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return $?
  fi

  if command_exists ss; then
    ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR > 1 { found = 1 } END { exit found ? 0 : 1 }'
    return $?
  fi

  return 1
}

kill_port_if_needed() {
  local port="$1"
  local label="$2"

  if command_exists fuser; then
    if fuser "${port}/tcp" >/dev/null 2>&1; then
      echo "Port ${port} is in use; killing process(es) for ${label}..."
      fuser -k "${port}/tcp" >/dev/null 2>&1 || true
    fi
    return
  fi

  if command_exists lsof; then
    local pids
    pids="$(lsof -ti TCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "Port ${port} is in use; killing process(es) for ${label}..."
      kill $pids 2>/dev/null || true
      kill -9 $pids 2>/dev/null || true
    fi
    return
  fi

  if command_exists ss; then
    if port_in_use "$port"; then
      local pids
      pids="$(ss -ltnp "( sport = :${port} )" 2>/dev/null \
        | awk -F'pid=' 'NR > 1 && NF > 1 { split($2, a, ","); if (a[1] ~ /^[0-9]+$/) print a[1] }' \
        | sort -u)"

      if [[ -n "$pids" ]]; then
        echo "Port ${port} is in use; killing process(es) for ${label}..."
        kill $pids 2>/dev/null || true
        kill -9 $pids 2>/dev/null || true
      else
        echo "Port ${port} is in use, but PID lookup failed."
      fi
    fi
    return
  fi

  echo "Warning: none of fuser, lsof, or ss is available; cannot auto-kill port ${port}." >&2
}

kill_pid() {
  local pid="$1"
  local name="$2"

  if ! pid_is_running "$pid"; then
    return
  fi

  echo "Stopping ${name} (PID ${pid})..."
  kill "$pid" 2>/dev/null || true

  local _i
  for _i in {1..20}; do
    if ! pid_is_running "$pid"; then
      break
    fi
    sleep 0.1
  done

  if pid_is_running "$pid"; then
    echo "Force killing ${name} (PID ${pid})..."
    kill -9 "$pid" 2>/dev/null || true
  fi
}

start_backend() {
  local pid
  pid="$(read_pid "$BACKEND_PID_FILE")"

  if [[ -n "$pid" ]] && pid_is_running "$pid"; then
    echo "Backend already running (PID ${pid})."
    return
  fi

  kill_port_if_needed "$BACKEND_PORT" "backend"

  echo "Starting backend on http://localhost:${BACKEND_PORT} ..."
  (
    cd "$BACKEND_DIR"
    ASPNETCORE_URLS="http://localhost:${BACKEND_PORT}" nohup dotnet run >"$BACKEND_LOG" 2>&1 &
    echo $! > "$BACKEND_PID_FILE"
  )

  local started_pid
  started_pid="$(read_pid "$BACKEND_PID_FILE")"
  if [[ -n "$started_pid" ]] && pid_is_running "$started_pid"; then
    echo "Backend started (PID ${started_pid}). Log: $BACKEND_LOG"
  else
    echo "Backend exited early. Check log: $BACKEND_LOG"
  fi
}

start_frontend() {
  local pid
  pid="$(read_pid "$FRONTEND_PID_FILE")"

  if [[ -n "$pid" ]] && pid_is_running "$pid"; then
    echo "Frontend already running (PID ${pid})."
    return
  fi

  kill_port_if_needed "$FRONTEND_PORT" "frontend"

  echo "Starting frontend on http://localhost:${FRONTEND_PORT} ..."
  (
    cd "$FRONTEND_DIR"
    nohup npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT" --strictPort >"$FRONTEND_LOG" 2>&1 &
    echo $! > "$FRONTEND_PID_FILE"
  )

  local started_pid
  started_pid="$(read_pid "$FRONTEND_PID_FILE")"
  if [[ -n "$started_pid" ]] && pid_is_running "$started_pid"; then
    echo "Frontend started (PID ${started_pid}). Log: $FRONTEND_LOG"
  else
    echo "Frontend exited early. Check log: $FRONTEND_LOG"
  fi
}

stop_backend() {
  local pid
  pid="$(read_pid "$BACKEND_PID_FILE")"

  if [[ -n "$pid" ]]; then
    kill_pid "$pid" "backend"
    rm -f "$BACKEND_PID_FILE"
  else
    echo "Backend PID file not found."
  fi
  kill_port_if_needed "$BACKEND_PORT" "backend"
}

stop_frontend() {
  local pid
  pid="$(read_pid "$FRONTEND_PID_FILE")"

  if [[ -n "$pid" ]]; then
    kill_pid "$pid" "frontend"
    rm -f "$FRONTEND_PID_FILE"
  else
    echo "Frontend PID file not found."
  fi
  kill_port_if_needed "$FRONTEND_PORT" "frontend"
}

show_status() {
  local backend_pid frontend_pid

  backend_pid="$(read_pid "$BACKEND_PID_FILE")"
  if [[ -n "$backend_pid" ]] && pid_is_running "$backend_pid"; then
    echo "Backend:  running (PID ${backend_pid})"
  else
    echo "Backend:  stopped"
  fi

  if port_in_use "$BACKEND_PORT"; then
    echo "Backend:  port ${BACKEND_PORT} is in use"
  else
    echo "Backend:  port ${BACKEND_PORT} is free"
  fi

  frontend_pid="$(read_pid "$FRONTEND_PID_FILE")"
  if [[ -n "$frontend_pid" ]] && pid_is_running "$frontend_pid"; then
    echo "Frontend: running (PID ${frontend_pid})"
  else
    echo "Frontend: stopped"
  fi

  if port_in_use "$FRONTEND_PORT"; then
    echo "Frontend: port ${FRONTEND_PORT} is in use"
  else
    echo "Frontend: port ${FRONTEND_PORT} is free"
  fi
}

validate_prerequisites() {
  local ok=true

  if command_exists dotnet; then
    echo "dotnet:  $(dotnet --version)"
  else
    echo "dotnet:  MISSING - install .NET SDK from https://dotnet.microsoft.com/en-us/download" >&2
    ok=false
  fi

  if command_exists npm; then
    echo "npm:     $(npm --version)"
  else
    echo "npm:     MISSING - install Node.js from https://nodejs.org" >&2
    ok=false
  fi

  if [[ "$ok" != "true" ]]; then
    exit 1
  fi
}

# --- Main ---
ACTION="${1:-}"

if [[ -z "$ACTION" ]]; then
  echo "ERROR: No action specified." >&2
  usage
  exit 1
fi

case "$ACTION" in
  start)
    validate_prerequisites
    mkdir -p "$LOG_DIR" "$PID_DIR"
    start_backend
    start_frontend
    echo ""
    echo "Dev app started."
    echo "Backend:  http://localhost:${BACKEND_PORT}"
    echo "Frontend: http://localhost:${FRONTEND_PORT}"
    echo "Logs:"
    echo "  $BACKEND_LOG"
    echo "  $FRONTEND_LOG"
    ;;
  stop)
    stop_backend
    stop_frontend
    echo ""
    echo "Dev app stopped."
    ;;
  restart)
    stop_backend
    stop_frontend
    validate_prerequisites
    mkdir -p "$LOG_DIR" "$PID_DIR"
    start_backend
    start_frontend
    echo ""
    echo "Dev app restarted."
    echo "Backend:  http://localhost:${BACKEND_PORT}"
    echo "Frontend: http://localhost:${FRONTEND_PORT}"
    ;;
  status)
    show_status
    ;;
  *)
    echo "ERROR: Unknown action '$ACTION'." >&2
    usage
    exit 1
    ;;
esac
