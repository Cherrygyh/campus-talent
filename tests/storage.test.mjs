import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('outputs/tests', { recursive: true });
await build({
  entryPoints: ['lib/storage.ts', 'lib/request-origin.ts'],
  outdir: 'outputs/tests',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const { LocalDatabase, LocalBucket } = await import(
  pathToFileURL(path.resolve('outputs/tests/storage.js')).href
);
const { hasTrustedOrigin } = await import(
  pathToFileURL(path.resolve('outputs/tests/request-origin.js')).href
);
const temporary = await mkdtemp(path.resolve('outputs/tests/storage-'));
const migrations = path.join(temporary, 'migrations');
await cp('drizzle', migrations, { recursive: true });
let db;
try {
  db = new LocalDatabase(temporary, migrations);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM _campus_migrations').first()).n, 3);
  await db
    .prepare('INSERT INTO candidates(id,data) VALUES (?,?)')
    .bind('persisted', '{"name":"测试"}')
    .run();
  await assert.rejects(
    db.batch([
      db.prepare('INSERT INTO candidates(id,data) VALUES (?,?)').bind('rolled-back', '{}'),
      db.prepare('INSERT INTO candidates(id,data) VALUES (?,?)').bind('persisted', '{}'),
    ]),
  );
  assert.equal(
    await db.prepare('SELECT id FROM candidates WHERE id=?').bind('rolled-back').first(),
    null,
  );
  db.sqlite.close();
  db = new LocalDatabase(temporary, migrations);
  assert.equal(
    (await db.prepare('SELECT data FROM candidates WHERE id=?').bind('persisted').first()).data,
    '{"name":"测试"}',
  );
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM _campus_migrations').first()).n, 3);
  const bucket = new LocalBucket(temporary);
  const content = '附件持久化测试';
  await bucket.put('attachments/test-file', new Blob([content]).stream());
  assert.equal(
    new TextDecoder().decode((await new LocalBucket(temporary).get('attachments/test-file')).body),
    content,
  );
  await assert.rejects(bucket.put('attachments/../../outside', new Blob(['x']).stream()));
  await bucket.delete('attachments/test-file');
  assert.equal(await bucket.get('attachments/test-file'), null);
  db.sqlite.close();
  db = undefined;
  const migrationFile = path.join(migrations, '0000_fuzzy_proudstar.sql');
  await writeFile(migrationFile, (await readFile(migrationFile, 'utf8')) + '\n-- changed');
  assert.throws(() => new LocalDatabase(temporary, migrations), /迁移文件被修改/);
  const previousOrigin = process.env.APP_ORIGIN;
  try {
    process.env.APP_ORIGIN = 'https://interview.example.com:8443';
    assert.equal(
      hasTrustedOrigin(
        new Request('http://localhost:6008/api/state', {
          headers: { origin: process.env.APP_ORIGIN },
        }),
      ),
      true,
    );
    assert.equal(
      hasTrustedOrigin(
        new Request('http://localhost:6008/api/state', {
          headers: { origin: 'https://untrusted.example' },
        }),
      ),
      false,
    );
  } finally {
    if (previousOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previousOrigin;
  }
  console.log(
    '本地存储验证通过：自动迁移、原子回滚、重启持久化、迁移校验、附件路径和代理来源校验。',
  );
} finally {
  db?.sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
