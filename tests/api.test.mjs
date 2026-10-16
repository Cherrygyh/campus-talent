if (process.env.TEST_DISPOSABLE_DB !== '1')
  throw new Error('请使用 npm run test:integration 启动独立测试库');
import { editorClient } from './helpers/editor-client.mjs';
import { localFetch } from './helpers/http.mjs';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { newCandidate } = await import(pathToFileURL(path.resolve('outputs/tests/talent.js')).href);
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5186';
const client = await editorClient(base, '接口回归');
assert.equal(client.join.status, 200);
const fetch = (url, options = {}) =>
  localFetch(url, { ...options, headers: { ...client.headers, ...options.headers } });
try {
  const syncStatus = await fetch(base + '/api/registration-sync');
  assert.equal(syncStatus.status, 200);
  assert.deepEqual(await syncStatus.json(), { configured: false, enabled: false, running: false });
  const noSyncSeat = await localFetch(base + '/api/registration-sync', { method: 'POST' });
  assert.equal(noSyncSeat.status, 423, '立即同步必须持有有效编辑席位');
  await noSyncSeat.text();
  const foreignSync = await fetch(base + '/api/registration-sync', {
    method: 'POST',
    headers: { Origin: 'https://untrusted.example' },
  });
  assert.equal(foreignSync.status, 403, '跨站请求不得触发同步');
  await foreignSync.text();
  const unconfiguredSync = await fetch(base + '/api/registration-sync', { method: 'POST' });
  assert.equal(unconfiguredSync.status, 200);
  assert.deepEqual(await unconfiguredSync.json(), {
    configured: false,
    enabled: false,
    running: false,
  });
  async function request(body) {
    const r = await fetch(
      base + '/api/state',
      body
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {},
    );
    return { status: r.status, data: await r.json() };
  }
  let s = (await request()).data;
  const originalCount = s.candidates.length;
  const people = Array.from({ length: 500 }, (_, i) =>
    newCandidate(s.config, {
      name: '接口测试' + i,
      studentId: 'P' + String(800000000 + i),
      batch: s.config.batches[0].id,
    }),
  );
  let r = await request({ op: 'import', revision: s.revision, candidates: people });
  assert.equal(r.status, 200);
  s = r.data;
  assert.equal(s.candidates.length, originalCount + 500);
  const importEvent = s.events[0].id;
  r = await request({
    op: 'import',
    revision: s.revision,
    candidates: [{ ...people[0], id: crypto.randomUUID() }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.candidates.length, s.candidates.length);
  let c = s.candidates.find((x) => x.id === people[0].id);
  const edit = {
    op: 'save',
    revision: s.revision,
    expectedUpdatedAt: c.updatedAt,
    candidate: { ...c, status: '录用', notes: '接口测试面试评价' },
  };
  const parallel = await Promise.all([request(edit), request(edit)]);
  assert.deepEqual(parallel.map((x) => x.status).sort(), [200, 409], '并发保存必须只允许一个成功');
  s = (await request()).data;
  const saveEvent = s.events.find((e) => e.summary.includes('接口测试0：'));
  r = await request({ op: 'undo', revision: s.revision, eventId: saveEvent.id });
  assert.equal(r.status, 200);
  s = r.data;
  assert.equal(s.candidates.find((x) => x.id === c.id).status, '待面试');
  r = await request({ op: 'undo', revision: s.revision, eventId: importEvent });
  assert.equal(r.status, 400, '后续更改应阻止撤回较早导入');
  // Fixtures stay in this run's isolated database for the five-editor preservation check.
  const invalid = await request({
    op: 'save',
    revision: s.revision,
    expectedUpdatedAt: s.candidates.find((x) => x.id === c.id).updatedAt,
    candidate: { ...c, scores: { foundation: 99 } },
  });
  assert.equal(invalid.status, 400);
  const evil = await fetch(base + '/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: JSON.stringify({ op: 'clearDemo', revision: s.revision }),
  });
  assert.equal(evil.status, 403);
  await evil.text();
  const form = new FormData();
  form.append('candidateId', c.id);
  form.append('file', new File(['not PDF'], 'fake.pdf', { type: 'application/pdf' }));
  const badfile = await fetch(base + '/api/files', { method: 'POST', body: form });
  assert.equal(badfile.status, 400);
  await badfile.text();
  const pdf =
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF';
  const f = new FormData();
  f.append('candidateId', c.id);
  f.append('file', new File([pdf], '测试材料.pdf', { type: 'application/pdf' }));
  const good = await fetch(base + '/api/files', { method: 'POST', body: f });
  assert.equal(good.status, 200);
  const file = await good.json();
  const download = await fetch(base + '/api/files/' + file.id);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.match(await download.text(), /^%PDF/);
  const removal = await fetch(base + '/api/files/' + file.id, { method: 'DELETE' });
  assert.equal(removal.status, 200);
  await removal.text();
  console.log(
    '接口验证通过：500 人批量入库、重复跳过、并发冲突、保存与撤回、后续修改保护、评分校验、跨站来源校验、附件校验和存取。',
  );
} finally {
  await client.leave();
}
