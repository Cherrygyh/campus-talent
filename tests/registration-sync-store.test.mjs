import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

await mkdir('outputs/tests', { recursive: true });
await build({
  entryPoints: ['lib/registration-sync-store.ts', 'lib/storage.ts'],
  outdir: 'outputs/tests/registration-store',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const store = await import(
  pathToFileURL(path.resolve('outputs/tests/registration-store/registration-sync-store.js')).href
);
const { LocalDatabase } = await import(
  pathToFileURL(path.resolve('outputs/tests/registration-store/storage.js')).href
);
const temporary = await mkdtemp(path.resolve('outputs/tests/registration-store-'));
const config = {
  enabled: true,
  sourceId: 'tencent-test',
  source: 'https://docs.qq.com/form/page/TEST',
  fileId: 'file-test',
  sheetId: 'sheet-test',
  batch: '2026-autumn',
  intervalSeconds: 120,
  tokenFile: path.join(temporary, 'private-token.json'),
};
const initial = {
  remoteId: 'record-1',
  name: '报名测试',
  className: '一班',
  studentId: 'P123456789',
  phone: '13800000000',
  email: 'test@example.com',
  extra: { 自我介绍: '初始回答' },
};
const now = Date.parse('2026-10-16T10:00:00.000Z');
const iso = (offset) => new Date(now + offset).toISOString();
const rows = (database) =>
  database.sqlite
    .prepare('SELECT data FROM candidates')
    .all()
    .map((row) => JSON.parse(row.data));
const revision = (database) =>
  database.sqlite.prepare("SELECT revision FROM workspace WHERE id='main'").get().revision;
let database;
let secondConnection;
try {
  database = new LocalDatabase(temporary);
  secondConnection = new LocalDatabase(temporary);
  assert.deepEqual(store.getRegistrationSyncStatus(database, now, temporary), {
    configured: false,
    enabled: false,
    running: false,
  });
  await writeFile(path.join(temporary, 'tencent-sync.json'), JSON.stringify(config), {
    mode: 0o600,
  });
  assert.equal(store.readRegistrationSyncConfig(temporary).tokenFile, config.tokenFile);
  await writeFile(
    path.join(temporary, 'tencent-sync.json'),
    JSON.stringify({ ...config, enabled: false }),
  );
  assert.equal(store.readRegistrationSyncConfig(temporary).enabled, false);
  assert.deepEqual(store.getRegistrationSyncStatus(database, now, temporary), {
    configured: true,
    enabled: false,
    running: false,
    source: config.source,
  });
  await writeFile(path.join(temporary, 'tencent-sync.json'), JSON.stringify(config));

  // The first full snapshot adds once. Identical snapshots neither change the revision
  // nor make an undo record that could later remove an interviewer's work.
  store.applyRegistrationSync(database, config, [initial], iso(0));
  assert.equal(revision(database), 1);
  assert.equal(rows(database).length, 1);
  const audit = JSON.parse(database.sqlite.prepare('SELECT data FROM events').get().data);
  assert.equal(audit.undoable, false);
  assert.deepEqual(audit.changes, []);
  const token = database.sqlite.prepare("SELECT token FROM workspace WHERE id='main'").get().token;
  const repeat = store.applyRegistrationSync(database, config, [initial], iso(1000));
  assert.equal(repeat.unchanged, 1);
  assert.equal(revision(database), 1);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM events').get().n, 1);

  // Interview changes arrive while the external fetch is in flight. Applying the
  // source snapshot must read the latest local row within the same write transaction.
  const candidate = rows(database)[0];
  database.sqlite
    .prepare(
      'INSERT INTO attachments(id,candidate_id,name,key,type,size,created_at) VALUES(?,?,?,?,?,?,?)',
    )
    .run('attachment', candidate.id, '材料.pdf', 'attachments/test', 'application/pdf', 10, iso(0));
  const interviewed = {
    ...candidate,
    status: '录用',
    notes: '面试官的评价',
    interviewer: '测试面试官',
    direction: '',
    scores: { interview_intro: 8 },
    phone: '13900000000',
    updatedAt: iso(1500),
  };
  let resolveFetch;
  let notifyFetch;
  const fetching = new Promise((resolve) => {
    notifyFetch = resolve;
  });
  const task = store.triggerRegistrationSync({
    database,
    dataDir: temporary,
    now: () => now + 2000,
    fetchRecords: async () => {
      notifyFetch();
      return new Promise((resolve) => {
        resolveFetch = resolve;
      });
    },
  });
  await fetching;
  assert.equal(
    store.getRegistrationSyncStatus(secondConnection, now + 2000, temporary).running,
    true,
  );
  assert.equal(store.acquireRegistrationSyncLease(secondConnection, 'overlap', now + 2000), false);
  secondConnection.sqlite
    .prepare('UPDATE candidates SET data=? WHERE id=?')
    .run(JSON.stringify(interviewed), interviewed.id);
  resolveFetch([
    { ...initial, className: '二班', phone: '13700000000', extra: { 自我介绍: '新回答' } },
  ]);
  const success = await task;
  assert.equal(success.running, false);
  assert.equal(success.counts.updated, 1);
  assert.equal(success.conflictCount, 1);
  assert.equal(success.lastSuccessAt, iso(2000));
  assert.equal(success.nextRunAt, iso(122000));
  const merged = rows(database)[0];
  assert.equal(merged.className, '二班');
  assert.equal(merged.extra.自我介绍, '新回答');
  assert.equal(merged.phone, '13900000000');
  for (const field of ['status', 'notes', 'interviewer', 'scores', 'createdAt'])
    assert.deepEqual(merged[field], interviewed[field]);
  assert.equal(database.sqlite.prepare('SELECT COUNT(*) AS n FROM attachments').get().n, 1);
  assert.equal(revision(database), 2);
  assert.notEqual(
    database.sqlite.prepare("SELECT token FROM workspace WHERE id='main'").get().token,
    token,
  );
  assert.deepEqual(success.conflicts[0].fields, ['phone']);
  assert.equal(JSON.stringify(success).includes(initial.name), false);
  assert.equal(JSON.stringify(success).includes(config.tokenFile), false);
  assert.equal(JSON.stringify(success).includes(initial.phone), false);

  // Persisted pending fields survive reopening the DB, keeping unresolved conflicts
  // visible across unchanged upstream snapshots and process restarts.
  database.sqlite.close();
  database = new LocalDatabase(temporary);
  store.applyRegistrationSync(
    database,
    config,
    [{ ...initial, className: '二班', phone: '13700000000', extra: { 自我介绍: '新回答' } }],
    iso(3000),
  );
  assert.equal(revision(database), 2);
  assert.equal(store.getRegistrationSyncStatus(database, now + 3000, temporary).conflictCount, 1);

  // A bad complete snapshot rolls back all rows/mappings. Missing source rows keep
  // candidates and attachments; an orphaned association cannot silently recreate one.
  const additional = {
    ...initial,
    remoteId: 'record-2',
    name: '新增测试',
    studentId: 'P987654321',
    phone: '',
    email: '',
  };
  assert.throws(
    () => store.applyRegistrationSync(database, config, [initial, initial, additional], iso(4000)),
    /重复远端/,
  );
  assert.equal(rows(database).length, 1);
  assert.equal(
    database.sqlite.prepare('SELECT COUNT(*) AS n FROM registration_sync_mappings').get().n,
    1,
  );
  store.applyRegistrationSync(database, config, [], iso(5000));
  assert.equal(rows(database).length, 1);
  assert.equal(revision(database), 2);
  database.sqlite.prepare('DELETE FROM attachments').run();
  database.sqlite.prepare('DELETE FROM candidates').run();
  assert.throws(
    () => store.applyRegistrationSync(database, config, [initial, additional], iso(6000)),
    /身份信息有冲突/,
  );
  assert.equal(rows(database).length, 0);

  // Crashed workers release by expiry. A former owner cannot release a new owner's lease.
  assert.equal(store.acquireRegistrationSyncLease(database, 'old', now + 10000, 100), true);
  assert.equal(
    store.acquireRegistrationSyncLease(secondConnection, 'new', now + 10050, 100),
    false,
  );
  assert.equal(store.acquireRegistrationSyncLease(secondConnection, 'new', now + 10101, 100), true);
  store.releaseRegistrationSyncLease(database, 'old');
  assert.equal(store.getRegistrationSyncStatus(database, now + 10150, temporary).running, true);
  assert.throws(
    () => store.applyRegistrationSync(database, config, [], iso(10150), 'old'),
    /已过期/,
  );
  store.releaseRegistrationSyncLease(secondConnection, 'new');

  // Unexpected transport errors are safe for the browser; backoff state persists.
  const failure = await store.triggerRegistrationSync({
    database,
    dataDir: temporary,
    now: () => now + 20000,
    fetchRecords: async () => {
      throw new Error('secret-token-and-personal-response');
    },
  });
  assert.equal(failure.running, false);
  assert.match(failure.error, /检查服务器配置/);
  assert.equal(JSON.stringify(failure).includes('secret-token'), false);
  assert.equal(failure.nextRunAt, iso(140000));
  const again = await store.triggerRegistrationSync({
    database,
    dataDir: temporary,
    now: () => now + 21000,
    fetchRecords: async () => {
      throw new Error('secret');
    },
  });
  assert.equal(again.nextRunAt, iso(261000));

  // A source disabled during a fetch cannot apply a stale snapshot.
  const changedConfig = await store.triggerRegistrationSync({
    database,
    dataDir: temporary,
    now: () => now + 22000,
    fetchRecords: async () => {
      await writeFile(
        path.join(temporary, 'tencent-sync.json'),
        JSON.stringify({ enabled: false }),
      );
      return [additional];
    },
  });
  assert.equal(changedConfig.enabled, false);
  assert.equal(changedConfig.configured, true);
  assert.equal(rows(database).length, 0);
  await writeFile(
    path.join(temporary, 'tencent-sync.json'),
    JSON.stringify({ ...config, intervalSeconds: 1 }),
  );
  assert.equal(store.getRegistrationSyncStatus(database, now, temporary).enabled, false);
  assert.match(store.getRegistrationSyncStatus(database, now, temporary).error, /同步配置无效/);
  console.log(
    '报名同步存储验证通过：原子增量、重复幂等、面试评价与附件保留、持久冲突、互斥租约和安全状态。',
  );
} finally {
  database?.sqlite.close();
  secondConnection?.sqlite.close();
  await rm(temporary, { recursive: true, force: true });
}
