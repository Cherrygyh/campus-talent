import { authorize, bucket, db, errorResponse, HttpError, json } from '../../../lib/server';
export async function POST(request: Request) {
  let key: string | undefined;
  try {
    const user = await authorize(request, true);
    if (Number(request.headers.get('content-length')) > 11 * 1024 * 1024)
      throw new HttpError('单个附件不能超过 10 MB', 413);
    const data = await request.formData();
    const file = data.get('file');
    const candidateId = String(data.get('candidateId') || '');
    if (!(file instanceof File) || file.size > 10 * 1024 * 1024 || !file.size)
      throw new HttpError('请上传 10 MB 以内的文件');
    const ext = file.name.split('.').pop()?.toLowerCase();
    const types: Record<string, string> = {
      pdf: 'application/pdf',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      txt: 'text/plain',
    };
    if (!ext || !types[ext]) throw new HttpError('附件支持 PDF、DOCX、PNG、JPG、TXT');
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    if (
      (ext === 'pdf' && new TextDecoder().decode(head).slice(0, 5) !== '%PDF-') ||
      (ext === 'docx' && (head[0] !== 80 || head[1] !== 75)) ||
      (ext === 'png' && (head[0] !== 137 || head[1] !== 80)) ||
      (['jpg', 'jpeg'].includes(ext) && (head[0] !== 255 || head[1] !== 216))
    )
      throw new HttpError('文件内容与扩展名不符，请检查原文件');
    const d = db();
    const c = await d.prepare('SELECT id FROM candidates WHERE id=?').bind(candidateId).first();
    if (!c) throw new HttpError('请先导入或保存对应报名');
    const count = await d
      .prepare('SELECT COUNT(*) AS n FROM attachments WHERE candidate_id=?')
      .bind(candidateId)
      .first<{ n: number }>();
    if ((count?.n || 0) >= 10) throw new HttpError('每人最多保存 10 个附件');
    const id = crypto.randomUUID();
    key = 'attachments/' + id;
    const time = new Date().toISOString();
    const name = file.name.replace(/[\r\n\x00]/g, '').slice(0, 200);
    await bucket().put(key, file.stream(), { httpMetadata: { contentType: types[ext] } });
    const event = {
      id: crypto.randomUUID(),
      time,
      actor: user.displayName,
      summary: '上传材料：' + name,
      undoable: false,
      changes: [],
    };
    await d.batch([
      d
        .prepare(
          'INSERT INTO attachments(id,candidate_id,name,key,type,size,created_at) VALUES (?,?,?,?,?,?,?)',
        )
        .bind(id, candidateId, name, key, types[ext], file.size, time),
      d.prepare('UPDATE workspace SET revision=revision+1 WHERE id=?').bind('main'),
      d
        .prepare('INSERT INTO events(id,time,data) VALUES (?,?,?)')
        .bind(event.id, time, JSON.stringify(event)),
    ]);
    return json({ id, name, message: '附件已保存' });
  } catch (e) {
    if (key)
      await bucket()
        .delete(key)
        .catch(() => {});
    return errorResponse(e);
  }
}
