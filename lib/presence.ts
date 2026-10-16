export const MAX_EDITORS = 5;
export const EDITOR_LEASE_MS = 60_000;
export type Presence = { limit: number; count: number; members: { name: string }[] };
export type EditorIdentity = { sessionId: string; clientId: string; name?: string };
export function validateIdentity(body: EditorIdentity): Required<EditorIdentity> {
  if (
    !body ||
    typeof body.sessionId !== 'string' ||
    typeof body.clientId !== 'string' ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(body.sessionId) ||
    !/^[a-zA-Z0-9_-]{16,80}$/.test(body.clientId)
  )
    throw new Error('协作会话无效，请刷新网页后重新进入');
  if (body.name !== undefined && typeof body.name !== 'string')
    throw new Error('面试官姓名格式无效');
  return {
    sessionId: body.sessionId,
    clientId: body.clientId,
    name: (body.name || '').trim().slice(0, 80) || '未署名面试官',
  };
}
const membersSql =
  'SELECT client_id, name FROM editor_sessions WHERE expires_at>? GROUP BY client_id ORDER BY client_id';
function view(rows: Record<string, unknown>[]): Presence {
  return {
    limit: MAX_EDITORS,
    count: rows.length,
    members: rows.map((r) => ({ name: String(r.name) })),
  };
}
export async function readPresence(d: Database, now = Date.now()): Promise<Presence> {
  const r = await d.prepare(membersSql).bind(now).all();
  return view(r.results);
}
export async function joinEditor(
  d: Database,
  input: EditorIdentity,
  now = Date.now(),
): Promise<Presence & { admitted: boolean }> {
  const body = validateIdentity(input);
  // A single guarded INSERT counts distinct browser identities while holding the SQLite write lock.
  const r = await d.batch([
    d.prepare('DELETE FROM editor_sessions WHERE expires_at<=?').bind(now),
    d
      .prepare(
        'INSERT INTO editor_sessions(id,client_id,name,expires_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM editor_sessions WHERE client_id=? AND expires_at>?) OR (SELECT COUNT(DISTINCT client_id) FROM editor_sessions WHERE expires_at>?)<? ON CONFLICT(id) DO UPDATE SET name=excluded.name,expires_at=excluded.expires_at WHERE editor_sessions.client_id=excluded.client_id RETURNING id',
      )
      .bind(
        body.sessionId,
        body.clientId,
        body.name,
        now + EDITOR_LEASE_MS,
        body.clientId,
        now,
        now,
        MAX_EDITORS,
      ),
    d.prepare(membersSql).bind(now),
  ]);
  return { ...view(r[2].results as Record<string, unknown>[]), admitted: r[1].results.length > 0 };
}
export async function leaveEditor(d: Database, input: EditorIdentity): Promise<Presence> {
  const body = validateIdentity(input);
  await d
    .prepare('DELETE FROM editor_sessions WHERE id=? AND client_id=?')
    .bind(body.sessionId, body.clientId)
    .run();
  return readPresence(d);
}
export async function hasEditorLease(
  d: Database,
  request: Request,
  now = Date.now(),
): Promise<boolean> {
  const sid = request.headers.get('x-editor-session');
  const cid = request.headers.get('x-editor-client');
  if (!sid || !cid) return false;
  return !!(await d
    .prepare('SELECT id FROM editor_sessions WHERE id=? AND client_id=? AND expires_at>?')
    .bind(sid, cid, now)
    .first());
}
import type { Database } from './storage';
