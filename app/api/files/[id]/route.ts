import { authorize, bucket, db, errorResponse, HttpError, json } from '../../../../lib/server';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await authorize(request);
    const { id } = await params;
    const row = await db()
      .prepare('SELECT key,name,type FROM attachments WHERE id=?')
      .bind(id)
      .first<{ key: string; name: string; type: string }>();
    if (!row) throw new HttpError('附件不存在', 404);
    const object = await bucket().get(row.key);
    if (!object) throw new HttpError('附件文件未找到', 404);
    const download = new URL(request.url).searchParams.has('download');
    const inline =
      !download && ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(row.type);
    return new Response(object.body, {
      headers: {
        'Content-Type': row.type,
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authorize(request, true);
    const { id } = await params;
    const d = db();
    const row = await d
      .prepare('SELECT key,name FROM attachments WHERE id=?')
      .bind(id)
      .first<{ key: string; name: string }>();
    if (!row) throw new HttpError('附件不存在', 404);
    const event = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      actor: user.displayName,
      summary: '移除材料：' + row.name,
      undoable: false,
      changes: [],
    };
    await d.batch([
      d.prepare('DELETE FROM attachments WHERE id=?').bind(id),
      d.prepare('UPDATE workspace SET revision=revision+1 WHERE id=?').bind('main'),
      d
        .prepare('INSERT INTO events(id,time,data) VALUES(?,?,?)')
        .bind(event.id, event.time, JSON.stringify(event)),
    ]);
    await bucket().delete(row.key);
    return json({ message: '附件已移除' });
  } catch (e) {
    return errorResponse(e);
  }
}
