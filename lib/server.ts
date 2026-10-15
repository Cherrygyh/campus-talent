import { env } from 'cloudflare:workers';
import {
  DEFAULT_CONFIG,
  Candidate,
  Config,
  Snapshot,
  adoptInterviewRubric,
  findDuplicate,
  scoreIds,
  validateCandidate,
  validateConfig,
} from './talent';
import { hasEditorLease, MAX_EDITORS } from './presence';
type Change = { before: Candidate | null; after: Candidate | null };
type InternalEvent = {
  id: string;
  time: string;
  actor: string;
  summary: string;
  undoable: boolean;
  undone?: boolean;
  changes: Change[];
  beforeConfig?: Config;
  afterConfig?: Config;
};
export const json = (data: unknown, status = 200) =>
  Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
export async function authorize(request: Request, write = false) {
  const suppliedName = decodeURIComponent(request.headers.get('x-interviewer-name') || '')
    .trim()
    .slice(0, 80);
  const user = { displayName: suppliedName || '未署名面试官' };
  if (write) {
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin)
      throw new HttpError('来源校验失败，请在本站操作', 403);
  }
  if (write && !(await hasEditorLease(db(), request)))
    throw new HttpError('当前没有有效的编辑席位，请刷新网页重新加入；同时最多 5 位面试官', 423);
  return user;
}
export class HttpError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function db(): D1Database {
  const d = (env as unknown as { DB?: D1Database }).DB;
  if (!d) throw new HttpError('数据库尚未连接', 503);
  return d;
}
export function bucket(): R2Bucket {
  const b = (env as unknown as { BUCKET?: R2Bucket }).BUCKET;
  if (!b) throw new HttpError('文件存储尚未连接', 503);
  return b;
}
export function errorResponse(e: unknown) {
  console.error(e instanceof Error ? e.message : 'Unexpected error');
  return json(
    { error: e instanceof HttpError || e instanceof Error ? e.message : '服务暂时不可用' },
    e instanceof HttpError ? e.status : 400,
  );
}
export async function snapshot(): Promise<Snapshot> {
  const d = db();
  await d
    .prepare('INSERT OR IGNORE INTO workspace (id,config) VALUES (?,?)')
    .bind('main', JSON.stringify(DEFAULT_CONFIG))
    .run();
  const res = await d.batch([
    d.prepare('SELECT revision,config FROM workspace WHERE id=?').bind('main'),
    d.prepare('SELECT data FROM candidates'),
    d.prepare(
      'SELECT id,candidate_id AS candidateId,name,type,size,created_at AS createdAt FROM attachments',
    ),
    d.prepare('SELECT data FROM events ORDER BY time DESC LIMIT 100'),
  ]);
  const w = res[0].results[0] as unknown as { revision: number; config: string };
  return {
    revision: w.revision,
    config: JSON.parse(w.config),
    candidates: (res[1].results as { data: string }[]).map((x) => JSON.parse(x.data)),
    attachments: res[2].results as unknown as Snapshot['attachments'],
    events: (res[3].results as { data: string }[]).map((x) => {
      const { changes, beforeConfig, afterConfig, ...event } = JSON.parse(x.data as string);
      return event;
    }),
  };
}
export async function mutate(
  body: Record<string, any>,
  actor: string,
  attempt = 0,
): Promise<Snapshot & { message: string }> {
  const s = await snapshot();
  if (body.revision !== s.revision && body.op !== 'save')
    throw new HttpError('名单已被更新，请刷新后重新保存；你本次输入仍保留在窗口中', 409);
  let config = s.config;
  const changes: Change[] = [];
  let summary = '';
  let undoSource: InternalEvent | null = null;
  const now = new Date().toISOString();
  if (body.op === 'save') {
    const c = validateCandidate(body.candidate, config);
    const old = s.candidates.find((x) => x.id === c.id) || null;
    if (old && body.expectedUpdatedAt !== old.updatedAt)
      throw new HttpError(
        '这位同学的记录已被另一位面试官修改，请关闭窗口刷新后再核对；当前输入仍保留',
        409,
      );
    const currentIds = new Set(config.rubric.map((r) => r.id));
    for (const archivedId of scoreIds(config))
      if (!currentIds.has(archivedId) && c.scores[archivedId] !== old?.scores[archivedId])
        throw new HttpError('评分规则已更新，历史评分仅供查看，请刷新网页后填写新维度', 409);
    if (
      findDuplicate(
        c,
        s.candidates.filter((x) => x.id !== c.id),
      )
    )
      throw new HttpError('已存在相同学号、电话或邮箱的报名，请先查重');
    changes.push({
      before: old,
      after: { ...c, name: c.name.trim(), createdAt: old?.createdAt || now, updatedAt: now },
    });
    summary = old
      ? `更新 ${c.name}：${old.status === c.status ? '报名信息或面试评价' : old.status + ' → ' + c.status}`
      : `新增报名：${c.name}`;
  } else if (body.op === 'import' || body.op === 'restore') {
    if (!Array.isArray(body.candidates) || !body.candidates.length || body.candidates.length > 500)
      throw new HttpError('每次请导入 1 至 500 人');
    if (body.op === 'restore') {
      const incoming = validateConfig(body.config);
      if (s.candidates.length && JSON.stringify(incoming) !== JSON.stringify(config))
        throw new HttpError(
          '当前库与备份配置不同，请先将备份名单导出为 CSV 再导入；现有资料未改动',
        );
      if (!s.candidates.length) config = incoming;
    }
    const seen = [...s.candidates];
    let skipped = 0;
    for (const v of body.candidates) {
      const c = validateCandidate(v, config);
      if (seen.some((x) => x.id === c.id) || findDuplicate(c, seen)) {
        skipped++;
        continue;
      }
      const after = { ...c, updatedAt: now, createdAt: body.op === 'restore' ? c.createdAt : now };
      changes.push({ before: null, after });
      seen.push(after);
    }
    summary = `${body.op === 'restore' ? '恢复备份' : '导入报名'} ${changes.length} 人，跳过重复 ${skipped} 人`;
  } else if (body.op === 'bulk') {
    if (
      !Array.isArray(body.ids) ||
      body.ids.length > 500 ||
      !['待面试', '面试中', '候补', '录用', '淘汰', '缺席'].includes(body.status)
    )
      throw new HttpError('批量操作参数无效');
    if (typeof body.reason !== 'string' || body.reason.length > 2000)
      throw new HttpError('结果备注过长');
    for (const c of s.candidates.filter((x) => body.ids.includes(x.id))) {
      changes.push({
        before: c,
        after: {
          ...c,
          status: body.status,
          updatedAt: now,
          notes: body.reason
            ? c.notes + (c.notes ? '\n' : '') + '结果备注：' + body.reason
            : c.notes,
        },
      });
    }
    summary = `${changes.length} 人标记为${body.status}${body.reason ? ' · ' + body.reason.slice(0, 80) : ''}`;
  } else if (body.op === 'settings') {
    if (body.expectedConfig !== JSON.stringify(config))
      throw new HttpError('设置已被其他面试官更改，请重新打开设置页核对', 409);
    config = validateConfig(body.config);
    if (
      s.candidates.some(
        (c) =>
          !config.batches.some((b) => b.id === c.batch) ||
          (c.direction && !config.directions.some((d) => d.id === c.direction)),
      )
    )
      throw new HttpError('已有报名使用的批次或方向不能删除');
    if (
      JSON.stringify(config.rubricArchives || []) !== JSON.stringify(s.config.rubricArchives || [])
    )
      throw new HttpError('历史评分规则需要保留，不能修改或删除');
    if (s.candidates.some((c) => Object.keys(c.scores).some((k) => !scoreIds(config).has(k))))
      throw new HttpError('已有面试使用的评分项不能删除，可修改名称和权重');
    summary = '更新工作室名称、招新批次与评分规则';
  } else if (body.op === 'interviewRubric') {
    if (body.expectedConfig !== JSON.stringify(config))
      throw new HttpError('设置已更新，请重新读取后再调整评分维度', 409);
    config = validateConfig(adoptInterviewRubric(config, now));
    summary = '根据五道考核问题更新面试评分维度，原评分保留为历史';
  } else if (body.op === 'clearDemo') {
    const demos = s.candidates.filter((c) => c.demo);
    if (s.attachments.some((a) => demos.some((c) => c.id === a.candidateId)))
      throw new HttpError('示例报名已有附加材料，请先保留备份或移除附件再清除');
    changes.push(...demos.map((c) => ({ before: c, after: null })));
    summary = `清除 ${demos.length} 条示例报名`;
  } else if (body.op === 'undo') {
    const row = await db()
      .prepare('SELECT data FROM events WHERE id=?')
      .bind(String(body.eventId))
      .first<{ data: string }>();
    if (!row) throw new HttpError('操作记录不存在');
    undoSource = JSON.parse(row.data) as InternalEvent;
    if (!undoSource.undoable || undoSource.undone) throw new HttpError('此操作无法撤回');
    for (const x of undoSource.changes) {
      const current = s.candidates.find((c) => c.id === (x.after || x.before)!.id) || null;
      if (JSON.stringify(current) !== JSON.stringify(x.after))
        throw new HttpError('相关报名之后已被修改，请在详情页调整，避免覆盖新评价');
      if (!x.before && s.attachments.some((a) => a.candidateId === x.after!.id))
        throw new HttpError('导入后已上传附件，不能撤回本次导入');
      changes.push({ before: current, after: x.before ? { ...x.before, updatedAt: now } : null });
    }
    if (undoSource.afterConfig) {
      if (JSON.stringify(config) !== JSON.stringify(undoSource.afterConfig))
        throw new HttpError('规则之后已更改，请在设置页调整');
      config = undoSource.beforeConfig!;
      if (
        s.candidates
          .filter((c) => !changes.some((x) => x.before?.id === c.id))
          .some(
            (c) =>
              !config.batches.some((b) => b.id === c.batch) ||
              (c.direction && !config.directions.some((d) => d.id === c.direction)) ||
              Object.keys(c.scores).some((k) => !scoreIds(config).has(k)),
          )
      )
        throw new HttpError('新规则已被其他报名使用，无法撤回');
    }
    summary = '撤回：' + undoSource.summary;
  } else throw new HttpError('不支持的操作');
  if (s.candidates.length + changes.filter((c) => !c.before && c.after).length > 3000)
    throw new HttpError('当前工作台最多保存 3000 条报名');
  if (!changes.length && JSON.stringify(config) === JSON.stringify(s.config))
    return { ...s, message: summary || '没有需要保存的更改' };
  const id = crypto.randomUUID();
  const token = crypto.randomUUID();
  const event: InternalEvent = {
    id,
    time: now,
    actor,
    summary,
    undoable: body.op !== 'undo',
    changes,
    ...(JSON.stringify(config) !== JSON.stringify(s.config)
      ? { beforeConfig: s.config, afterConfig: config }
      : {}),
  };
  const d = db();
  const writes: D1PreparedStatement[] = [
    d
      .prepare(
        'UPDATE workspace SET revision=revision+1, token=?, config=? WHERE id=? AND revision=? RETURNING revision',
      )
      .bind(token, JSON.stringify(config), 'main', s.revision),
  ];
  // Every mutation is guarded by the token set in the same atomic D1 batch.
  const upserts = changes.filter((x) => x.after).map((x) => x.after);
  const deletes = changes.filter((x) => !x.after).map((x) => x.before!.id);
  if (upserts.length)
    writes.push(
      d
        .prepare(
          "INSERT INTO candidates(id,data) SELECT json_extract(value,'$.id'),value FROM json_each(?) WHERE EXISTS(SELECT 1 FROM workspace WHERE id=? AND token=?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .bind(JSON.stringify(upserts), 'main', token),
    );
  if (deletes.length)
    writes.push(
      d
        .prepare(
          'DELETE FROM candidates WHERE id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM workspace WHERE id=? AND token=?)',
        )
        .bind(JSON.stringify(deletes), 'main', token),
    );
  writes.push(
    d
      .prepare(
        'INSERT INTO events(id,time,data) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM workspace WHERE id=? AND token=?)',
      )
      .bind(id, now, JSON.stringify(event), 'main', token),
  );
  if (undoSource)
    writes.push(
      d
        .prepare(
          'UPDATE events SET data=? WHERE id=? AND EXISTS(SELECT 1 FROM workspace WHERE id=? AND token=?)',
        )
        .bind(
          JSON.stringify({ ...undoSource, undone: true, undoable: false }),
          undoSource.id,
          'main',
          token,
        ),
    );
  const result = await d.batch(writes);
  if (!result[0].results.length) {
    if (body.op === 'save' && attempt < MAX_EDITORS - 1) return mutate(body, actor, attempt + 1);
    throw new HttpError('另一位面试官刚刚保存了结果，请刷新后重试', 409);
  }
  return { ...(await snapshot()), message: summary };
}
