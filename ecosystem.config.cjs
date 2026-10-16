const path = require('node:path');
const root = __dirname;
module.exports = {
  apps: [
    {
      name: 'campus-talent',
      script: path.join(root, '.next/standalone/server.js'),
      cwd: path.join(root, '.next/standalone'),
      interpreter: process.execPath,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 2000,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        HOSTNAME: '0.0.0.0',
        PORT: process.env.PORT || '3000',
        DATA_DIR: process.env.DATA_DIR || path.join(root, 'data'),
        APP_ORIGIN: process.env.APP_ORIGIN || '',
      },
    },
  ],
};
