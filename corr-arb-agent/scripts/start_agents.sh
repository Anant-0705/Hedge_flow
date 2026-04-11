#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXECUTOR_DIR="$PROJECT_ROOT/executor"
LOG_DIR="$PROJECT_ROOT/logs/agents"
PID_DIR="$PROJECT_ROOT/.runtime"

PYTHON_BIN="$PROJECT_ROOT/venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  # Try Windows path
  PYTHON_BIN="$PROJECT_ROOT/venv/Scripts/python.exe"
fi

if [[ ! -x "$PYTHON_BIN" && -x "$PROJECT_ROOT/../.venv/bin/python" ]]; then
  PYTHON_BIN="$PROJECT_ROOT/../.venv/bin/python"
fi
if [[ ! -x "$PYTHON_BIN" && -x "$PROJECT_ROOT/../.venv/Scripts/python.exe" ]]; then
  PYTHON_BIN="$PROJECT_ROOT/../.venv/Scripts/python.exe"
fi

mkdir -p "$LOG_DIR" "$PID_DIR"

is_running() {
  local pattern="$1"
  pgrep -f "$pattern" >/dev/null 2>&1
}

start_service() {
  local name="$1"
  local cwd="$2"
  local pattern="$3"
  shift 3
  local -a cmd=("$@")

  local log_file="$LOG_DIR/${name}.log"
  local pid_file="$PID_DIR/${name}.pid"

  if is_running "$pattern"; then
    echo "[skip] $name already running ($pattern)"
    return
  fi

  (
    cd "$cwd"
    nohup "${cmd[@]}" >>"$log_file" 2>&1 &
    echo $! >"$pid_file"
  )

  sleep 0.5

  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[ok] started $name (pid=$pid)"
      echo "     log: $log_file"
      return
    fi
  fi

  echo "[warn] $name may not have started; check $log_file"
}

if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "[error] Python executable not found at $PROJECT_ROOT/venv/bin/python or ../.venv/bin/python"
  exit 1
fi

echo "Starting CorrArbAgent services from: $PROJECT_ROOT"

start_service "monitor" "$PROJECT_ROOT" "agent.signal_monitor" \
  env PYTHONPATH="$PROJECT_ROOT" "$PYTHON_BIN" -m agent.signal_monitor

start_service "watcher" "$EXECUTOR_DIR" "node trade_watcher.js" \
  node trade_watcher.js

start_service "settler" "$EXECUTOR_DIR" "node trade_settler.js" \
  node trade_settler.js

echo
echo "Current process snapshot:"
ps aux | grep -E "agent.signal_monitor|trade_watcher.js|trade_settler.js" | grep -v grep || true
