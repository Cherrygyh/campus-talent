#!/usr/bin/env bash
set -euo pipefail
if [[ -f /etc/campus-talent-autostart.conf ]]; then
  source /etc/campus-talent-autostart.conf
fi
campus_project="${CAMPUS_TALENT_PROJECT_DIR:-/root/autodl-tmp/campus-talent}"
exec 9>/tmp/campus-talent-boot.lock
flock -n 9 || exit 0
# AutoDL can source /etc/profile before the data volume becomes available.
# Do not block PID 1, and do not pass the boot lock to the PM2 daemon.
for campus_attempt in {1..120}; do
  if [[ -f "$campus_project/scripts/service.sh" ]]; then
    if /bin/bash "$campus_project/scripts/service.sh" start 9>&- \
      && /bin/bash "$campus_project/scripts/service.sh" health 9>&-; then
      printf '%s campus-talent startup completed.\n' "$(date -Iseconds)"
      exit 0
    fi
  fi
  sleep 2
done
printf '%s campus-talent startup failed; check the PM2 logs.\n' "$(date -Iseconds)" >&2
exit 1

