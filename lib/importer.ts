import { Candidate, Config, newCandidate, norm } from './talent';
export type Table = { name: string; headers: string[]; rows: string[][] };
export type LocalAttachment = { file: File; candidateId: string; hint: string };
export const FIELDS = [
  ['name', '姓名'],
  ['className', '班级'],
  ['studentId', '学号'],
  ['phone', '电话'],
  ['email', '邮箱'],
] as const;
const aliases: Record<string, string[]> = {
  name: ['姓名', '名字', '学生姓名', '报名姓名', 'name'],
  className: ['班级', '所在班级', '专业班级', '班级名称', 'class'],
  studentId: ['学号', '学生学号', '学生编号', 'studentid'],
  phone: ['电话', '手机', '手机号', '联系电话', '手机号码', 'phone'],
  email: ['邮箱', '电子邮箱', 'email', '电子邮件'],
  direction: ['方向', '报名方向', '意向部门', '部门', '报名部门', '组别', '意向组别'],
};
export function guessMapping(headers: string[]): Record<string, number> {
  return Object.fromEntries(
    FIELDS.map(([key]) => [
      key,
      headers.findIndex((h) => aliases[key].includes(norm(h).replace(/[（(].*?[)）]/g, ''))),
    ]),
  );
}
export function parseDelimited(text: string, delimiter?: string): string[][] {
  text = text.replace(/^\uFEFF/, '');
  delimiter = delimiter || (text.split(/\r?\n/)[0].includes('\t') ? '\t' : ',');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += ch;
    } else if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (quoted) throw new Error('表格中的引号未闭合，请检查复制内容或 CSV 文件');
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}
export function tableFromRows(name: string, rows: unknown[][]): Table {
  const strings = rows
    .map((row) =>
      row.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c ?? '').trim())),
    )
    .filter((r) => r.some(Boolean));
  const headerIndex = strings.findIndex((row) => guessMapping(row).name >= 0);
  const index = headerIndex >= 0 ? headerIndex : 0;
  if (!strings.length) throw new Error(name + ' 没有可导入的数据');
  return {
    name,
    headers: strings[index].map((h, i) => h || '未命名列 ' + (i + 1)),
    rows: strings.slice(index + 1),
  };
}
export function rowsToCandidates(
  table: Table,
  mapping: Record<string, number>,
  config: Config,
  batch: string,
  _direction: string,
  source: string,
): { candidates: Candidate[]; errors: string[] } {
  if (mapping.name == null || mapping.name < 0) throw new Error('请把姓名列对应到“姓名”字段');
  const used = Object.values(mapping).filter((i) => i >= 0);
  if (new Set(used).size !== used.length) throw new Error('同一列不能对应多个字段');
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  table.rows.forEach((r, index) => {
    const val = (k: string) => (mapping[k] >= 0 ? String(r[mapping[k]] ?? '').trim() : '');
    if (!val('name')) {
      errors.push(`第 ${index + 2} 行没有姓名，已跳过`);
      return;
    }
    const studentId = val('studentId').toUpperCase();
    if (studentId && !/^P\d{9}$/.test(studentId)) {
      errors.push(
        `第 ${index + 2} 行 ${val('name')} 的学号“${studentId}”不符合 P 加 9 位数字，已跳过`,
      );
      return;
    }
    const extra = Object.fromEntries(table.headers.map((h, i) => [h, r[i] || '']));
    candidates.push(
      newCandidate(config, {
        name: val('name'),
        className: val('className'),
        studentId,
        phone: val('phone'),
        email: val('email'),
        batch,
        direction: '',
        source,
        extra,
      }),
    );
  });
  if (candidates.length > 500) throw new Error('单次最多导入 500 人，请分批导入');
  return { candidates, errors };
}
export async function readTables(file: File): Promise<Table[]> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (file.size > 30 * 1024 * 1024) throw new Error(file.name + ' 超过 30 MB');
  if (ext === 'xlsx') {
    const { default: readXlsxFile } = await import('read-excel-file/browser');
    const sheets = await readXlsxFile(file, { parseNumber: (s) => s });
    const result: Table[] = [];
    for (const sheet of sheets.slice(0, 20)) {
      if (sheet.data.length)
        result.push(tableFromRows(file.name + ' · ' + sheet.sheet, sheet.data));
    }
    return result;
  }
  if (['csv', 'tsv', 'txt'].includes(ext || '')) {
    const bytes = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.includes('\uFFFD')) text = new TextDecoder('gb18030').decode(bytes);
    return [tableFromRows(file.name, parseDelimited(text, ext === 'tsv' ? '\t' : undefined))];
  }
  throw new Error('表格支持 XLSX、CSV、TSV；旧版 XLS 请先另存为 XLSX');
}
export async function readPackage(
  file: File,
): Promise<{ tables: Table[]; files: File[]; warnings: string[] }> {
  if (file.size > 30 * 1024 * 1024) throw new Error('ZIP 不能超过 30 MB');
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const entries = Object.values(zip.files).filter(
    (e) =>
      !e.dir &&
      !e.name.startsWith('__MACOSX/') &&
      !e.name.split('/').some((x) => x.startsWith('.')),
  );
  if (entries.length > 600) throw new Error('压缩包最多包含 600 个文件');
  type SizedEntry = (typeof entries)[number] & { _data?: { uncompressedSize?: number } };
  const total = entries.reduce((s, e) => s + ((e as SizedEntry)._data?.uncompressedSize || 0), 0);
  if (total > 80 * 1024 * 1024) throw new Error('解压后不能超过 80 MB，请拆分压缩包');
  const tables: Table[] = [];
  const files: File[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    const size = (entry as SizedEntry)._data?.uncompressedSize || 0;
    if (size > 10 * 1024 * 1024) {
      warnings.push(entry.name + ' 超过 10 MB，未导入');
      continue;
    }
    const ext = entry.name.split('.').pop()?.toLowerCase();
    const name = entry.name.split('/').pop()!;
    if (!['xlsx', 'csv', 'tsv', 'pdf', 'docx', 'jpg', 'jpeg', 'png', 'txt'].includes(ext || '')) {
      warnings.push(entry.name + ' 格式不支持，未导入');
      continue;
    }
    const f = new File([await entry.async('arraybuffer')], name);
    if (['xlsx', 'csv', 'tsv'].includes(ext!)) {
      try {
        tables.push(...(await readTables(f)));
      } catch (e) {
        warnings.push(name + '：' + (e as Error).message);
      }
    } else files.push(f);
  }
  return { tables, files, warnings };
}
export function matchAttachment(
  file: File,
  candidates: Candidate[],
): { candidateId: string; hint: string } {
  const stem = norm(file.name.replace(/\.[^.]+$/, ''));
  const byId = candidates.filter(
    (c) => norm(c.studentId).length >= 4 && stem.includes(norm(c.studentId)),
  );
  if (byId.length === 1) return { candidateId: byId[0].id, hint: '按学号匹配' };
  const byName = candidates.filter((c) => norm(c.name).length >= 2 && stem.includes(norm(c.name)));
  if (byName.length === 1) return { candidateId: byName[0].id, hint: '按姓名匹配，请核对' };
  return {
    candidateId: '',
    hint:
      byName.length > 1 || byId.length > 1 ? '同名或多条匹配，请手动选择' : '未匹配，请选择报名人',
  };
}
