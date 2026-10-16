if (process.env.TEST_DISPOSABLE_DB !== '1')
  throw new Error('请使用 npm run test:integration 启动独立测试库');
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { editorClient } from './helpers/editor-client.mjs';
import { localFetch as fetch } from './helpers/http.mjs';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5186';
if (!/^http:\/\/(127\.0\.0\.1|localhost):/.test(base))
  throw new Error('此写入模拟只允许在本地测试库执行');
const { newCandidate } = await import(pathToFileURL(path.resolve('outputs/tests/talent.js')).href);
const result = [];
const clients = [];
const snapshot = async () => await (await fetch(base + '/api/state')).json();
const post = async (client, body) => {
  const r = await client.request('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, data: await r.json() };
};
try {
  const arrivals = await Promise.all(
    Array.from({ length: 6 }, (_, i) => editorClient(base, '并发验收 ' + (i + 1))),
  );
  clients.push(...arrivals);
  const active = arrivals.filter((c) => c.join.status === 200),
    waiting = arrivals.find((c) => c.join.status === 429);
  assert.equal(active.length, 5);
  assert.ok(waiting);
  result.push({ case: '6人同时进入', passed: true, admitted: 5, waiting: 1 });
  const duplicate = await editorClient(base, '并发验收同浏览器标签', active[0].identity.clientId);
  clients.push(duplicate);
  assert.equal(duplicate.join.status, 200);
  assert.equal(duplicate.join.data.count, 5);
  await duplicate.leave();
  result.push({ case: '同浏览器多标签计为1人', passed: true });
  const before = await snapshot();
  const records = Array.from({ length: 5 }, (_, i) =>
    newCandidate(before.config, {
      name: '五人模拟-' + (i + 1),
      studentId: 'P' + String(720000000 + i),
      demo: true,
    }),
  );
  let r = await post(waiting, { op: 'import', revision: before.revision, candidates: records });
  assert.equal(r.status, 423);
  const noSession = await fetch(base + '/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'import', revision: before.revision, candidates: records }),
  });
  assert.equal(noSession.status, 423);
  await noSession.text();
  const file = new FormData();
  file.append('candidateId', records[0].id);
  file.append('file', new File(['test'], 'test.txt'));
  const upload = await waiting.request('/api/files', { method: 'POST', body: file });
  assert.equal(upload.status, 423);
  await upload.text();
  const deletion = await waiting.request('/api/files/not-a-file', { method: 'DELETE' });
  assert.equal(deletion.status, 423);
  await deletion.text();
  result.push({ case: '等待会话及无席位请求无法写入或上传', passed: true });
  r = await post(active[0], { op: 'import', revision: before.revision, candidates: records });
  assert.equal(r.status, 200);
  let s = r.data;
  for (let round = 1; round <= 3; round++) {
    const saved = await Promise.all(
      active.map((client, i) => {
        const c = s.candidates.find((c) => c.id === records[i].id);
        return post(client, {
          op: 'save',
          revision: s.revision,
          expectedUpdatedAt: c.updatedAt,
          candidate: {
            ...c,
            notes: `第${round}轮 / 面试官${i + 1}`,
            scores: Object.fromEntries(s.config.rubric.map((x) => [x.id, 6 + i * 0.5])),
          },
        });
      }),
    );
    assert.ok(
      saved.every((x) => x.status === 200),
      JSON.stringify(saved.map((x) => ({ status: x.status, error: x.data.error }))),
    );
    s = await snapshot();
    for (let i = 0; i < 5; i++)
      assert.equal(
        s.candidates.find((c) => c.id === records[i].id).notes,
        `第${round}轮 / 面试官${i + 1}`,
      );
  }
  result.push({ case: '5人同时编辑不同报名，连续3轮', passed: true, saves: 15 });
  const one = s.candidates.find((c) => c.id === records[0].id);
  const conflicts = await Promise.all(
    active.map((client, i) =>
      post(client, {
        op: 'save',
        revision: s.revision,
        expectedUpdatedAt: one.updatedAt,
        candidate: { ...one, notes: '同人并发-' + i },
      }),
    ),
  );
  assert.deepEqual(conflicts.map((x) => x.status).sort(), [200, 409, 409, 409, 409]);
  s = await snapshot();
  result.push({ case: '5人同时编辑同一报名', passed: true, saved: 1, conflicts: 4 });
  const winnerEvent = s.events.find((e) => e.summary.startsWith('更新 五人模拟-1'));
  r = await post(active[0], { op: 'undo', revision: s.revision, eventId: winnerEvent.id });
  assert.equal(r.status, 200);
  s = r.data;
  assert.equal(s.candidates.find((c) => c.id === one.id).notes, one.notes);
  result.push({ case: '冲突操作后撤回结果', passed: true });
  const observations = await Promise.all(
    active.map((client) => client.request('/api/state').then((r) => r.json())),
  );
  assert.ok(observations.every((x) => x.revision === s.revision));
  for (const view of observations) assert.deepEqual(view.candidates, s.candidates);
  result.push({ case: '5个独立会话读取一致的结果', passed: true });
  await active[0].leave();
  assert.equal((await waiting.heartbeat()).status, 200);
  result.push({ case: '有人离开后等待者补位', passed: true });
  const final = await snapshot();
  for (const original of before.candidates)
    assert.deepEqual(
      final.candidates.find((c) => c.id === original.id),
      original,
    );
  assert.deepEqual(final.config, before.config);
  assert.deepEqual(final.attachments, before.attachments);
  result.push({ case: '模拟前已有报名、评分和附件保持原样', passed: true });
  await mkdir('outputs', { recursive: true });
  await writeFile(
    'outputs/五人协作模拟验收.json',
    JSON.stringify(
      { time: new Date().toISOString(), environment: base, passed: result.length, cases: result },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: result.length, cases: result }, null, 2));
} finally {
  await Promise.all(clients.map((c) => c.leave().catch(() => {})));
}
