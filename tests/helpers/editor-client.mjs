import { localFetch as fetch } from './http.mjs';

export async function editorClient(
  base,
  name,
  clientId = crypto.randomUUID(),
  sessionId = crypto.randomUUID(),
) {
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('接口写入测试只允许使用本地独立数据库');
  }
  const identity = { clientId, sessionId, name };
  const headers = {
    'x-editor-client': clientId,
    'x-editor-session': sessionId,
    'x-interviewer-name': encodeURIComponent(name),
  };
  const presence = async (op) => {
    const r = await fetch(base + '/api/presence', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...identity, op }),
    });
    return { status: r.status, data: await r.json() };
  };
  const request = (url, options = {}) =>
    fetch(base + url, { ...options, headers: { ...headers, ...options.headers } });
  const join = await presence('join');
  return {
    identity,
    headers,
    join,
    request,
    leave: () => presence('leave'),
    heartbeat: () => presence('join'),
  };
}
