import { build } from 'esbuild';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
await mkdir('.sites-runtime/tests', { recursive: true });
await build({
  entryPoints: ['lib/presence.ts'],
  outfile: '.sites-runtime/tests/presence.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
});
const p = await import(pathToFileURL(path.resolve('.sites-runtime/tests/presence.mjs')).href);
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(
  'CREATE TABLE editor_sessions (id TEXT PRIMARY KEY,client_id TEXT NOT NULL,name TEXT NOT NULL,expires_at INTEGER NOT NULL)',
);
function prepared(sql, values = []) {
  const run = () => {
    const stmt = sqlite.prepare(sql);
    if (stmt.columns().length) return { results: stmt.all(...values) };
    stmt.run(...values);
    return { results: [] };
  };
  return {
    bind(...args) {
      return prepared(sql, args);
    },
    all: async () => run(),
    run: async () => run(),
    first: async () => run().results[0] || null,
    _run: run,
  };
}
const db = {
  prepare: prepared,
  batch: async (statements) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const r = statements.map((s) => s._run());
      sqlite.exec('COMMIT');
      return r;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  },
};
const people = Array.from({ length: 6 }, (_, i) => ({
  clientId: crypto.randomUUID(),
  sessionId: crypto.randomUUID(),
  name: '模拟面试官' + i,
}));
const t = 100_000;
for (let i = 0; i < 5; i++) assert.equal((await p.joinEditor(db, people[i], t)).admitted, true);
assert.equal((await p.joinEditor(db, people[5], t)).admitted, false);
assert.equal((await p.readPresence(db, t)).count, 5);
const tab = { ...people[0], sessionId: crypto.randomUUID() };
assert.equal((await p.joinEditor(db, tab, t)).count, 5, '同浏览器新标签不应重复占位');
await p.leaveEditor(db, people[0]);
assert.equal(
  (await p.joinEditor(db, people[5], t)).admitted,
  false,
  '同浏览器仍有其他标签时保留席位',
);
await p.leaveEditor(db, tab);
assert.equal((await p.joinEditor(db, people[5], t)).admitted, true);
sqlite.exec('DELETE FROM editor_sessions');
for (let i = 0; i < 5; i++) await p.joinEditor(db, people[i], t);
for (let i = 0; i < 4; i++) await p.joinEditor(db, people[i], t + 30_000);
assert.equal((await p.joinEditor(db, people[5], t + 60_001)).admitted, true, '断线到期应释放名额');
assert.equal((await p.readPresence(db, t + 60_001)).count, 5);
const req = (i) =>
  new Request('http://localhost', {
    headers: { 'x-editor-session': people[i].sessionId, 'x-editor-client': people[i].clientId },
  });
assert.equal(await p.hasEditorLease(db, req(4), t + 60_001), false);
assert.equal(await p.hasEditorLease(db, req(0), t + 60_001), true);
assert.equal(await p.hasEditorLease(db, new Request('http://localhost'), t), false);
assert.ok(
  (await p.readPresence(db, t + 60_001)).members.every((x) => Object.keys(x).join(',') === 'name'),
  '在线列表不应返回可用于操作其他会话的编号',
);
sqlite.close();
console.log(
  '席位验证通过：5人上限、第6人等待、多标签共用名额、离开释放、心跳续期、断线过期、无席位禁止写入。',
);
