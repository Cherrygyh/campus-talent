#!/usr/bin/env bash
set -euo pipefail
if [[ "$(id -u)" != 0 ]]; then
  echo 'Run as root inside the AutoDL instance.' >&2
  exit 1
fi
campus_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -f "$campus_root/.env.service" || ! -f "$campus_root/.next/standalone/server.js" ]]; then
  echo 'Configure .env.service and run npm run build before installing startup.' >&2
  exit 1
fi
command -v flock >/dev/null
command -v curl >/dev/null
install -d -m 755 /usr/local/lib/campus-talent
install -m 755 "$campus_root/deploy/autodl/boot-start.sh" /usr/local/lib/campus-talent/boot-start.sh
printf 'CAMPUS_TALENT_PROJECT_DIR=%q\n' "$campus_root" > /etc/campus-talent-autostart.conf
chmod 600 /etc/campus-talent-autostart.conf
install -m 644 "$campus_root/deploy/autodl/campus-talent.profile.sh" /etc/profile.d/campus-talent-autostart.sh
echo 'AutoDL boot hook installed. Test with: CAMPUS_TALENT_BOOT_CHECK=1 bash -lc true'

