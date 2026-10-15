'use client';
import { editorHeaders } from './collaboration';
import { useState, useMemo, useRef } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Link,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FolderArchive,
  Download,
  Loader2,
  Paperclip,
} from 'lucide-react';
import { Snapshot, csvCell, findDuplicate, safeUrl } from '../../lib/talent';
import {
  FIELDS,
  Table,
  guessMapping,
  matchAttachment,
  parseDelimited,
  readPackage,
  readTables,
  rowsToCandidates,
  tableFromRows,
} from '../../lib/importer';
type Props = {
  state: Snapshot;
  mutate: (b: Record<string, unknown>) => Promise<Snapshot>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
};
export default function ImportPanel({ state, mutate, refresh, notify }: Props) {
  const [mode, setMode] = useState('file');
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [tables, setTables] = useState<Table[]>([]);
  const [index, setIndex] = useState(0);
  const [mapping, setMapping] = useState<Record<string, number>>({});
  const [files, setFiles] = useState<File[]>([]);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState(state.config.batches[0].id);
  const direction = ''; // Legacy importer argument; this workbench does not use groups.
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [lastResult, setLastResult] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const table = tables[index];
  const parsed = useMemo(() => {
    try {
      return table
        ? rowsToCandidates(table, mapping, state.config, batch, direction, source || table.name)
        : { candidates: [], errors: [] };
    } catch (e) {
      return { candidates: [], errors: [(e as Error).message] };
    }
  }, [table, mapping, state.config, batch, direction, source]);
  const preview = useMemo(() => {
    const seen = [...state.candidates];
    return parsed.candidates.map((c) => {
      const duplicate = findDuplicate(c, seen);
      if (!duplicate) seen.push(c);
      return { c, duplicate };
    });
  }, [parsed, state.candidates]);
  const newPeople = preview.filter((x) => !x.duplicate).map((x) => x.c);
  const people = [...state.candidates, ...newPeople];
  const fileMappings = files.map((file, i) => {
    const matched = matchAttachment(file, people);
    return {
      file,
      key: String(i),
      candidateId: targets[String(i)] ?? matched.candidateId,
      hint: matched.hint,
    };
  });
  function selectTable(i: number) {
    setIndex(i);
    setMapping(guessMapping(tables[i].headers));
    setTargets({});
  }
  async function load(input: FileList | null) {
    if (!input?.length) return;
    setError('');
    setLastResult('');
    setBusy(true);
    setProgress('正在读取文件…');
    try {
      const nextTables: Table[] = [];
      const nextFiles: File[] = [];
      const nextWarnings: string[] = [];
      for (const file of Array.from(input)) {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext === 'zip') {
          const r = await readPackage(file);
          nextTables.push(...r.tables);
          nextFiles.push(...r.files);
          nextWarnings.push(...r.warnings);
        } else if (['xlsx', 'csv', 'tsv'].includes(ext || ''))
          nextTables.push(...(await readTables(file)));
        else if (['pdf', 'docx', 'txt', 'png', 'jpg', 'jpeg'].includes(ext || ''))
          nextFiles.push(file);
        else nextWarnings.push(file.name + ' 格式不支持');
      }
      setTables(nextTables);
      setIndex(0);
      setMapping(nextTables[0] ? guessMapping(nextTables[0].headers) : {});
      setFiles(nextFiles);
      setTargets({});
      setWarnings(nextWarnings);
      if (!nextTables.length && !nextFiles.length) throw new Error('没有可导入的报名表或材料');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setProgress('');
      if (picker.current) picker.current.value = '';
    }
  }
  function pastePreview() {
    try {
      if (source && (!safeUrl(source) || new URL(source).hostname !== 'docs.qq.com'))
        throw new Error('来源链接请使用 docs.qq.com 的腾讯文档链接，也可以留空');
      const t = tableFromRows('腾讯文档粘贴', parseDelimited(text));
      if (!t.rows.length) throw new Error('请复制表头和至少一行报名数据');
      setTables([t]);
      setIndex(0);
      setMapping(guessMapping(t.headers));
      setFiles([]);
      setTargets({});
      setWarnings([]);
      setError('');
      setLastResult('');
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function commit() {
    if (parsed.errors.length && table && mapping.name < 0) {
      setError(parsed.errors[0]);
      return;
    }
    const attachments = fileMappings.filter((x) => x.candidateId);
    if (!newPeople.length && !attachments.length) {
      setError('没有新的报名或已指定报名人的附件');
      return;
    }
    if (
      !window.confirm(
        `确认导入 ${newPeople.length} 位新报名和 ${attachments.length} 份材料？重复报名将跳过，未指定报名人的材料不会上传。`,
      )
    )
      return;
    setBusy(true);
    setError('');
    let saved = 0;
    let uploaded = 0;
    const failures: string[] = [];
    try {
      setProgress('正在保存报名…');
      if (newPeople.length) {
        await mutate({ op: 'import', candidates: newPeople });
        saved = newPeople.length;
      }
      for (let i = 0; i < attachments.length; i++) {
        const a = attachments[i];
        setProgress(`上传材料 ${i + 1} / ${attachments.length}：${a.file.name}`);
        const form = new FormData();
        form.append('file', a.file);
        form.append('candidateId', a.candidateId);
        try {
          const r = await fetch('/api/files', {
            method: 'POST',
            headers: {
              ...editorHeaders(),
              'x-interviewer-name': encodeURIComponent(
                localStorage.getItem('shicai-interviewer') || '',
              ),
            },
            body: form,
          });
          const d = (await r.json()) as { error?: string };
          if (!r.ok) throw new Error(d.error);
          uploaded++;
        } catch (e) {
          failures.push(a.file.name + '：' + (e as Error).message);
        }
      }
      await refresh();
      const result = `已保存 ${saved} 位报名、${uploaded} 份材料${failures.length ? '；' + failures.length + ' 份材料失败，见下方' : ''}`;
      setLastResult(result);
      notify(result);
      setFiles(
        fileMappings
          .filter((a) => !a.candidateId || failures.some((f) => f.startsWith(a.file.name + '：')))
          .map((a) => a.file),
      );
      setTables([]);
      setTargets({});
      setWarnings(failures);
    } catch (e) {
      setError((e as Error).message + (saved ? `（${saved} 位报名已保存）` : ''));
    } finally {
      setBusy(false);
      setProgress('');
    }
  }
  function downloadTemplate() {
    const content =
      '\uFEFF' +
      [
        ['姓名', '班级', '学号', '电话', '邮箱', '自我介绍'].map(csvCell).join(','),
        [
          '示例姓名',
          '软件2401',
          'P012345678',
          '13800000000',
          'example@example.com',
          '请替换为真实报名信息',
        ]
          .map(csvCell)
          .join(','),
      ].join('\r\n');
    const u = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = u;
    a.download = '报名表模板.csv';
    a.click();
    URL.revokeObjectURL(u);
  }
  return (
    <div className="import-page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">从报名到面试</span>
          <h2>把名单带进来</h2>
          <p>一次整理好报名信息，现场只需要搜索名字。</p>
        </div>
        <button className="btn secondary" onClick={downloadTemplate}>
          <Download size={16} />
          下载表格模板
        </button>
      </div>
      <div className="import-options">
        <button
          className={mode === 'file' ? 'import-option active' : 'import-option'}
          onClick={() => setMode('file')}
        >
          <FolderArchive />
          <strong>本地文件 / 压缩包</strong>
          <span>Excel、CSV 或带报名材料的 ZIP</span>
        </button>
        <button
          className={mode === 'paste' ? 'import-option active' : 'import-option'}
          onClick={() => setMode('paste')}
        >
          <FileSpreadsheet />
          <strong>腾讯文档表格</strong>
          <span>复制表头与数据，直接粘贴导入</span>
        </button>
      </div>
      <section className="surface import-source">
        {mode === 'file' ? (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept=".xlsx,.csv,.tsv,.zip,.pdf,.docx,.txt,.jpg,.jpeg,.png"
              hidden
              onChange={(e) => load(e.target.files)}
            />
            <button
              className="dropzone"
              disabled={busy}
              onClick={() => picker.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy) load(e.dataTransfer.files);
              }}
            >
              <span className="upload-icon">
                <Upload size={25} />
              </span>
              <strong>选择文件，或把文件拖到这里</strong>
              <span>报名表支持 XLSX / CSV / TSV · ZIP 内可附带 PDF、Word、图片</span>
              <small>ZIP 最大 30 MB，解压后最大 80 MB；附件每份 10 MB；一次最多 500 人</small>
            </button>
            <p className="helper">材料命名建议：学号_姓名.pdf。同名材料请在预览中手动核对。</p>
          </>
        ) : (
          <>
            <div className="info-strip">
              <Link size={17} />
              <span>
                在腾讯文档中复制表头和报名数据，粘贴到下方；也可将表格导出为 Excel
                后上传。链接用于保留来源。
              </span>
            </div>
            <label>
              腾讯文档来源链接（选填）
              <input
                placeholder="https://docs.qq.com/sheet/…"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
            <label>
              粘贴表格内容
              <textarea
                rows={6}
                placeholder={
                  '姓名\t班级\t学号\t电话\t邮箱\n张同学\t软件2401\tP123456789\t138…\txxx@…'
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <div className="row-between">
              <small className="muted">需要包含表头。自动同步需另行接入腾讯文档授权。</small>
              <button className="btn" onClick={pastePreview} disabled={!text.trim() || busy}>
                预览数据
                <ArrowRight size={16} />
              </button>
            </div>
          </>
        )}
        {busy && (
          <div className="info-strip">
            <Loader2 className="spin" size={18} />
            {progress}
          </div>
        )}
      </section>
      {error && (
        <div className="alert error" role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {lastResult && (
        <div className="alert success">
          <CheckCircle2 size={18} />
          {lastResult}
        </div>
      )}
      {tables.length > 0 && (
        <section className="surface mapping">
          <div className="row-between">
            <h3>1. 对应表格字段</h3>
            <span className="tag">{table?.rows.length || 0} 行数据</span>
          </div>
          <div className="three-cols">
            <label>
              导入哪个工作表
              <select value={index} onChange={(e) => selectTable(Number(e.target.value))}>
                {tables.map((t, i) => (
                  <option key={i} value={i}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              所属招新批次
              <select value={batch} onChange={(e) => setBatch(e.target.value)}>
                {state.config.batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mapping-grid">
            {FIELDS.map(([key, label]) => (
              <label key={key}>
                {label}
                {key === 'name' && <em> *</em>}
                <select
                  value={mapping[key] ?? -1}
                  onChange={(e) => {
                    setMapping({ ...mapping, [key]: Number(e.target.value) });
                    setTargets({});
                  }}
                >
                  <option value={-1}>不导入此字段</option>
                  {table?.headers.map((h, i) => (
                    <option value={i} key={i}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <p className="helper">
            表格中的其他列也会保留在报名详情中。学号与电话按文本处理；Excel
            中已丢失的前导零无法自动补回。多工作表请逐个导入。
          </p>
          <div className="row-between">
            <h3>2. 核对报名预览</h3>
            <span className="muted">
              新增 {newPeople.length} 人 · 重复 {preview.length - newPeople.length} 人
            </span>
          </div>
          <div className="table-scroll preview-table">
            <table>
              <thead>
                <tr>
                  <th>姓名</th>
                  <th>班级</th>
                  <th>学号</th>
                  <th>电话</th>
                  <th>邮箱</th>
                  <th>处理</th>
                </tr>
              </thead>
              <tbody>
                {preview.slice(0, 50).map(({ c, duplicate }) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.className || '—'}</td>
                    <td>{c.studentId || '—'}</td>
                    <td>{c.phone || '—'}</td>
                    <td>{c.email || '—'}</td>
                    <td>
                      <span className={'tag ' + (duplicate ? 'amber' : 'green')}>
                        {duplicate ? '重复，跳过' : '新增'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 50 && (
            <p className="helper">显示前 50 行，提交时会处理全部 {preview.length} 行。</p>
          )}
          {parsed.errors.map((e, i) => (
            <p key={i} className="error-text">
              {e}
            </p>
          ))}
        </section>
      )}
      {files.length > 0 && (
        <section className="surface mapping">
          <h3>
            <Paperclip size={17} /> 对应报名材料
          </h3>
          <p className="helper">
            材料先指定报名人再上传。未匹配的文件会保留在这里，不会自动生成报名。
          </p>
          {fileMappings.map((a, i) => (
            <div className="file-map" key={i}>
              <div>
                <strong>{a.file.name}</strong>
                <small>
                  {a.hint} · {(a.file.size / 1024).toFixed(0)} KB
                </small>
              </div>
              <select
                aria-label={a.file.name + '对应报名人'}
                value={a.candidateId}
                onChange={(e) => setTargets({ ...targets, [a.key]: e.target.value })}
              >
                <option value="">请选择报名人 / 暂不上传</option>
                {people.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {c.className || '班级未填'} · {c.studentId || '学号未填'}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </section>
      )}
      {warnings.length > 0 && (
        <div className="alert warning">
          <AlertCircle size={18} />
          <div>
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        </div>
      )}
      {(tables.length > 0 || files.length > 0) && (
        <div className="import-footer">
          <span>
            {newPeople.length} 位新报名 · {fileMappings.filter((a) => a.candidateId).length}{' '}
            份材料待保存
          </span>
          <button
            className="btn"
            disabled={busy || (!newPeople.length && !fileMappings.some((a) => a.candidateId))}
            onClick={commit}
          >
            {busy ? <Loader2 size={17} className="spin" /> : <CheckCircle2 size={17} />}确认导入
          </button>
        </div>
      )}
    </div>
  );
}
