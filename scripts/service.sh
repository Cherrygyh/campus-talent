#!/usr/bin/env bash
set -euo pipefail
service_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
service_env="${CAMPUS_SERVICE_ENV:-${service_root}/.env.service}"
if [[ -f "$service_env" ]]; then
  set -a
  source "$service_env"
  set +a
fi
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
PM2_CLI="${PM2_CLI:-$(command -v pm2 || true)}"
if [[ ! -x "$NODE_BIN" || ! -f "$PM2_CLI" ]]; then
  echo 'Set absolute NODE_BIN and PM2_CLI paths in .env.service.' >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
export PM2_HOME="${PM2_HOME:-${service_root}/.pm2}"
export PORT="${PORT:-3000}"
export DATA_DIR="${DATA_DIR:-${service_root}/data}"
export APP_ORIGIN="${APP_ORIGIN:-}"
if [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
  echo 'PORT must be a number.' >&2
  exit 1
fi
cd "$service_root"
case "${1:-start}" in
  start)
    for service_name in campus-talent campus-talent-sync; do
      service_pid="$("$NODE_BIN" "$PM2_CLI" pid "$service_name" | tail -n 1)"
      if [[ "$service_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$service_pid" 2>/dev/null; then
        echo "$service_name is already running."
      else
        "$NODE_BIN" "$PM2_CLI" startOrRestart ecosystem.config.cjs --only "$service_name" --update-env
      fi
    done
    "$NODE_BIN" "$PM2_CLI" save
    ;;
  restart)
    "$NODE_BIN" "$PM2_CLI" startOrRestart ecosystem.config.cjs --update-env
    "$NODE_BIN" "$PM2_CLI" save
    ;;
  stop)
    for service_name in campus-talent campus-talent-sync; do
      service_pid="$("$NODE_BIN" "$PM2_CLI" pid "$service_name" | tail -n 1)"
      if [[ "$service_pid" =~ ^[1-9][0-9]*$ ]] && kill -0 "$service_pid" 2>/dev/null; then
        "$NODE_BIN" "$PM2_CLI" stop "$service_name"
      fi
    done
    ;;
  status) "$NODE_BIN" "$PM2_CLI" status ;;
  logs) "$NODE_BIN" "$PM2_CLI" logs --lines 100 ;;
  health) curl -fsS --connect-timeout 2 --max-time 5 "http://127.0.0.1:${PORT}/api/presence" >/dev/null ;;
  *) echo "Usage: $0 [start|restart|stop|status|logs|health]" >&2; exit 2 ;;
esac

