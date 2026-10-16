import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every run uses a fresh isolated database, never the live data directory.
await mkdir('outputs', { recursive: true });
const state = await mkdtemp(path.resolve('outputs/integration-'));
async function run(args, env = process.env) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${code}): ${args[0]}`)),
    );
  });
}
await run(['tests/core.test.mjs']);
const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const environment = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  DATA_DIR: state,
  PORT: String(port),
  HOSTNAME: '127.0.0.1',
  APP_ORIGIN: base,
};
let child;
async function start() {
  child = spawn(process.execPath, ['scripts/start-server.mjs'], {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  });
  let failure;
  child.on('error', (error) => {
    failure = error;
  });
  for (let i = 0; i < 120; i++) {
    if (failure) throw failure;
    if (child.exitCode !== null) throw new Error(`Server exited: ${child.exitCode}`);
    try {
      if ((await fetch(base + '/api/presence')).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Timed out waiting for the production server');
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  const force = setTimeout(() => child.kill('SIGKILL'), 5000);
  try {
    await exited;
  } finally {
    clearTimeout(force);
  }
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });
try {
  await start();
  const initial = await (await fetch(base + '/api/state')).json();
  assert.equal(initial.candidates.length, 0, 'Integration tests require a fresh isolated database');
  const response = await fetch(base + '/');
  assert.equal(response.status, 200, 'Home page must render');
  const html = await response.text();
  assert.ok(
    html.includes('拾才') && html.includes(version),
    'Home page must contain the product version',
  );
  const testEnv = { ...environment, TEST_BASE_URL: base, TEST_DISPOSABLE_DB: '1' };
  await run(['tests/api.test.mjs'], testEnv);
  await run(['tests/five-editors.test.mjs'], testEnv);
  const final = await (await fetch(base + '/api/presence')).json();
  assert.equal(final.count, 0, 'All editor sessions must be released');
  const beforeRestart = await (await fetch(base + '/api/state')).json();
  await stop();
  await start();
  assert.deepEqual(
    await (await fetch(base + '/api/state')).json(),
    beforeRestart,
    'Restart must preserve all data',
  );
  await writeFile(
    'outputs/integration-summary.json',
    JSON.stringify(
      {
        version,
        time: new Date().toISOString(),
        passed: true,
        isolatedDatabase: true,
        releasedSessions: true,
        suites: ['home-render', 'api', 'five-editors', 'restart-persistence'],
      },
      null,
      2,
    ),
  );
  console.log('服务器回归通过，重启后数据保留，测试席位已全部释放。');
} finally {
  await stop();
}
