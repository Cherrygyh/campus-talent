import './sites-env.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Every run uses a new local D1/R2 directory, never the personal or hosted database.
const state = path.resolve('.wrangler/integration', crypto.randomUUID(), 'state');
const config = path.resolve('dist/server/wrangler.json');
const wrangler = path.resolve('node_modules/wrangler/bin/wrangler.js');
const envModule = pathToFileURL(path.resolve('scripts/sites-env.mjs')).href;
const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false' };
async function run(args, env = environment) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`Command failed (${code}): ${args[0]}`)),
    );
  });
}
await run(['tests/core.test.mjs']);
await mkdir(state, { recursive: true });
for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
  await run([
    '--import',
    envModule,
    wrangler,
    'd1',
    'execute',
    'DB',
    '--local',
    '--config',
    config,
    '--persist-to',
    state,
    '--file',
    path.resolve('drizzle', file),
  ]);
}
const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', resolve);
});
const port = probe.address().port;
await new Promise((resolve) => probe.close(resolve));
// Run the built Worker directly in Miniflare. Development proxy reloads must
// not interfere with concurrent HTTP writes in the acceptance tests.
const { unstable_getMiniflareWorkerOptions } = await import('wrangler');
const { Miniflare } = await import('miniflare');
const { workerOptions, main, externalWorkers } = unstable_getMiniflareWorkerOptions(config);
const moduleRoot = path.dirname(main);
const modules = (await readdir(moduleRoot, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(m?js)$/.test(entry.name))
  .map((entry) => ({ type: 'ESModule', path: path.join(entry.parentPath, entry.name) }))
  .filter((entry) => entry.path !== main);
modules.unshift({ type: 'ESModule', path: main });
const server = new Miniflare({
  host: '127.0.0.1',
  port,
  cf: false,
  d1Persist: path.join(state, 'v3/d1'),
  r2Persist: path.join(state, 'v3/r2'),
  workers: [
    {
      ...workerOptions,
      name: 'campus-talent-integration',
      modules,
      modulesRoot: moduleRoot,
    },
    ...externalWorkers,
  ],
});
const base = (await server.ready).origin;
let stopping;
const stop = () => (stopping ??= server.dispose());
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void stop();
  });
try {
  const initial = await (await fetch(base + '/api/state')).json();
  assert.equal(initial.candidates.length, 0, 'Integration tests require a fresh isolated database');
  const response = await fetch(base + '/');
  assert.equal(response.status, 200, 'Home page must render');
  const html = await response.text();
  assert.ok(
    html.includes('拾才') && html.includes('1.0.0'),
    'Home page must contain the product version',
  );
  const testEnv = { ...environment, TEST_BASE_URL: base, TEST_DISPOSABLE_DB: '1' };
  await run(['tests/api.test.mjs'], testEnv);
  await run(['tests/five-editors.test.mjs'], testEnv);
  const final = await (await fetch(base + '/api/presence')).json();
  assert.equal(final.count, 0, 'All editor sessions must be released');
  await mkdir('outputs', { recursive: true });
  await writeFile(
    'outputs/integration-summary.json',
    JSON.stringify(
      {
        version: '1.0.0',
        time: new Date().toISOString(),
        passed: true,
        isolatedDatabase: true,
        releasedSessions: true,
        suites: ['home-render', 'api', 'five-editors'],
      },
      null,
      2,
    ),
  );
  console.log('独立测试库回归通过，测试席位已全部释放。');
} finally {
  await stop();
}
