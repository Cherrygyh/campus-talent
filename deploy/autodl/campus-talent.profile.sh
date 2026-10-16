# AutoDL's PID 1 boot shell sources /etc/profile before its built-in services.
# Normal SSH/Jupyter login shells must not restart the application.
if [ "$$" = "1" ] || [ "${CAMPUS_TALENT_BOOT_CHECK:-0}" = "1" ]; then
  if [ -x /usr/local/lib/campus-talent/boot-start.sh ]; then
    /usr/bin/nohup /bin/bash /usr/local/lib/campus-talent/boot-start.sh \
      >> /tmp/campus-talent-boot.log 2>&1 < /dev/null &
  fi
fi

