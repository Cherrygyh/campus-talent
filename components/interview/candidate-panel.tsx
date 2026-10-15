'use client';
import { editorHeaders } from './collaboration';
import { useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  Phone,
  Mail,
  GraduationCap,
  Paperclip,
  Download,
  Upload,
  Loader2,
  ArrowUpRight,
  Save,
  UserRound,
  XCircle,
  CheckCircle2,
  Clock,
  Trash2,
} from 'lucide-react';
import PdfPreview from './pdf-preview';
import RubricFields from './rubric-fields';
import {
  Attachment,
  Candidate,
  Config,
  Status,
  totalScore,
  safeUrl,
  validateCandidate,
} from '../../lib/talent';
type Props = {
  candidate: Candidate;
  config: Config;
  attachments: Attachment[];
  userName: string;
  onClose: () => void;
  onSave: (c: Candidate) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
};
export default function CandidatePanel({
  candidate,
  config,
  attachments,
  userName,
  onClose,
  onSave,
  refresh,
  notify,
}: Props) {
  const [draft, setDraft] = useState<Candidate>(() => structuredClone(candidate));
  const [edit, setEdit] = useState(!candidate.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<Status | null>(null);
  const [preview, setPreview] = useState<Attachment | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const score = totalScore(draft, config);
  const dirty = JSON.stringify(draft) !== JSON.stringify(candidate);
  function close() {
    if (!dirty || window.confirm('有尚未保存的面试评价或信息，确认离开？')) onClose();
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstInput.current?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (preview) setPreview(null);
        else if (confirm) setConfirm(null);
        else close();
      }
      if (e.key === 'Tab' && panel.current) {
        const focusables = Array.from(
          panel.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]',
          ),
        ).filter((el) => el.offsetParent !== null);
        const first = focusables[0],
          last = focusables.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', listener);
    return () => {
      document.removeEventListener('keydown', listener);
      previous?.focus();
    };
  }, [dirty, preview, confirm]);
  function patch(key: keyof Candidate, value: unknown) {
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function save(status?: Status) {
    setBusy(true);
    setError('');
    try {
      const value = {
        ...draft,
        status: status || draft.status,
        interviewer: draft.interviewer || userName,
      };
      validateCandidate(value, config);
      await onSave(value);
      onClose();
    } catch (e) {
      setError((e as Error).message);
      setConfirm(null);
    } finally {
      setBusy(false);
    }
  }
  async function attach(input: FileList | null) {
    if (!input?.length) return;
    setBusy(true);
    setError('');
    try {
      if (!candidate.name) throw new Error('请先保存报名，再上传材料');
      for (const file of Array.from(input)) {
        const form = new FormData();
        form.append('file', file);
        form.append('candidateId', candidate.id);
        const r = await fetch('/api/files', {
          method: 'POST',
          headers: { ...editorHeaders(), 'x-interviewer-name': encodeURIComponent(userName) },
          body: form,
        });
        const d = (await r.json()) as { error?: string };
        if (!r.ok) throw new Error(d.error);
      }
      await refresh();
      notify('报名材料已保存');
    } catch (e) {
      setError((e as Error).message);
      await refresh().catch(() => {});
    } finally {
      setBusy(false);
      if (filePicker.current) filePicker.current.value = '';
    }
  }
  async function remove(a: Attachment) {
    if (!window.confirm(`确认移除“${a.name}”？该附件将永久删除，报名信息和面试结果会保留。`))
      return;
    setBusy(true);
    try {
      const r = await fetch('/api/files/' + a.id, {
        method: 'DELETE',
        headers: { ...editorHeaders(), 'x-interviewer-name': encodeURIComponent(userName) },
      });
      const d = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(d.error);
      await refresh();
      notify('附件已移除');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const sourceUrl = safeUrl(draft.source);
  return (
    <div
      className="overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="candidate-panel"
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-title"
      >
        <header className="panel-header">
          <div>
            <span className="eyebrow">
              {config.batches.find((b) => b.id === draft.batch)?.name} / 报名详情
            </span>
            <div className="panel-title">
              <span className="avatar large">{draft.name?.slice(0, 1) || <UserRound />}</span>
              <div>
                <h2 id="candidate-title">
                  {draft.name || '新增报名'}
                  {draft.demo && <span className="tag amber">示例</span>}
                </h2>
                <p>
                  {draft.className || '班级待补充'}
                  <span>·</span>
                  {draft.studentId || '学号待补充'}
                </p>
              </div>
              <span className={'status status-' + draft.status}>{draft.status}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={close} aria-label="关闭报名详情">
            <X size={21} />
          </button>
        </header>
        <div className="panel-body">
          <div className="registration">
            <div className="row-between">
              <h3>
                <GraduationCap size={18} />
                报名信息
              </h3>
              <button className="text-btn" onClick={() => setEdit(!edit)}>
                {edit ? '完成编辑' : '编辑信息'}
              </button>
            </div>
            {edit ? (
              <div className="form-grid">
                {(
                  [
                    ['name', '姓名'],
                    ['className', '班级'],
                    ['studentId', '学号'],
                    ['phone', '电话'],
                    ['email', '邮箱'],
                  ] as const
                ).map(([key, label], i) => (
                  <label key={key}>
                    {label}
                    {key === 'name' && <em> *</em>}
                    <input
                      ref={i === 0 ? firstInput : undefined}
                      value={draft[key]}
                      maxLength={200}
                      onChange={(e) => patch(key, e.target.value)}
                    />
                  </label>
                ))}
                <label>
                  招新批次
                  <select value={draft.batch} onChange={(e) => patch('batch', e.target.value)}>
                    {config.batches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : (
              <dl className="info-grid">
                <div>
                  <dt>姓名</dt>
                  <dd>{draft.name}</dd>
                </div>
                <div>
                  <dt>班级</dt>
                  <dd>{draft.className || '未填写'}</dd>
                </div>
                <div>
                  <dt>学号</dt>
                  <dd className="mono">{draft.studentId || '未填写'}</dd>
                </div>
                <div>
                  <dt>
                    <Phone size={13} />
                    电话
                  </dt>
                  <dd>{draft.phone || '未填写'}</dd>
                </div>
                <div>
                  <dt>
                    <Mail size={13} />
                    邮箱
                  </dt>
                  <dd>{draft.email || '未填写'}</dd>
                </div>
              </dl>
            )}
            {Object.keys(draft.extra).length > 0 && (
              <>
                <h3 className="spaced-heading">原报名表内容</h3>
                <dl className="original-fields">
                  {Object.entries(draft.extra).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v || '未填写'}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            <div className="row-between spaced-heading">
              <h3>
                <Paperclip size={17} />
                附带材料 <span className="muted">{attachments.length}</span>
              </h3>
              <input
                ref={filePicker}
                type="file"
                hidden
                multiple
                accept=".pdf,.docx,.txt,.png,.jpg,.jpeg"
                onChange={(e) => attach(e.target.files)}
              />
              <button
                className="text-btn"
                disabled={busy || !candidate.name}
                onClick={() => filePicker.current?.click()}
              >
                <Upload size={14} />
                添加材料
              </button>
            </div>
            {attachments.length ? (
              <div className="attachment-list">
                {attachments.map((a) => (
                  <div className="attachment" key={a.id}>
                    <Paperclip size={17} />
                    <button
                      className="file-name"
                      onClick={() =>
                        ['application/pdf', 'image/png', 'image/jpeg', 'text/plain'].includes(
                          a.type,
                        )
                          ? setPreview(a)
                          : window.open('/api/files/' + a.id, '_blank', 'noopener')
                      }
                    >
                      {a.name}
                      <small>{(a.size / 1024).toFixed(0)} KB</small>
                    </button>
                    <a
                      className="icon-btn"
                      href={'/api/files/' + a.id + '?download=1'}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={'下载 ' + a.name}
                    >
                      <Download size={16} />
                    </a>
                    <button
                      className="icon-btn muted"
                      disabled={busy}
                      onClick={() => remove(a)}
                      aria-label={'删除 ' + a.name}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="no-attachment">
                <Paperclip size={21} />
                <p>这位同学暂未附带材料</p>
                <small>只有报名表，也可以正常面试和记录结果。</small>
              </div>
            )}
            <div className="source-note">
              来源：
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
                  查看原始文档
                  <ArrowUpRight size={12} />
                </a>
              ) : (
                draft.source
              )}
              <br />
              报名时间：
              {new Date(draft.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
            </div>
          </div>
          <aside className="evaluation">
            <div className="evaluation-title">
              <div>
                <span className="eyebrow">线下面试记录</span>
                <h3>给出你的判断</h3>
              </div>
              <div className="score-large">
                {score ?? '—'}
                <small>/100</small>
              </div>
            </div>
            <p className="helper">每项 0–10 分，按权重折算。评分可选，未评完不显示总分。</p>
            <RubricFields
              candidate={draft}
              config={config}
              onChange={(scores) => patch('scores', scores)}
            />
            <label>
              面试官
              <input
                value={draft.interviewer}
                onChange={(e) => patch('interviewer', e.target.value)}
                placeholder={userName}
                maxLength={200}
              />
            </label>
            <label>
              面试评价 / 结果备注
              <textarea
                rows={5}
                value={draft.notes}
                maxLength={10000}
                onChange={(e) => patch('notes', e.target.value)}
                placeholder="记录现场表现、追问要点和作出决定的原因…"
              />
            </label>
            <label>
              当前面试状态
              <select
                value={draft.status}
                onChange={(e) => {
                  const status = e.target.value as Status;
                  if (['录用', '淘汰'].includes(status)) setConfirm(status);
                  else patch('status', status);
                }}
              >
                {['待面试', '面试中', '候补', '录用', '淘汰', '缺席'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <div className="decision-tip">
              <Clock size={15} />
              <span>结果由面试官确认。所有保存均有记录，可在操作记录中撤回。</span>
            </div>
          </aside>
        </div>
        {error && (
          <div className="panel-error" role="alert">
            {error}
          </div>
        )}
        <footer className="panel-footer">
          <button className="btn secondary" disabled={busy} onClick={() => save()}>
            {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}保存评价
          </button>
          <div className="decision-buttons">
            <button
              className="btn danger-outline"
              disabled={busy}
              onClick={() => setConfirm('淘汰')}
            >
              <XCircle size={16} />
              淘汰
            </button>
            <button className="btn secondary" disabled={busy} onClick={() => setConfirm('候补')}>
              <Clock size={16} />
              候补
            </button>
            <button className="btn" disabled={busy} onClick={() => setConfirm('录用')}>
              <CheckCircle2 size={17} />
              确认录用
            </button>
          </div>
        </footer>
        {confirm && (
          <div className="confirm-shade">
            <div className="confirm-box" role="alertdialog" aria-labelledby="confirm-title">
              <span className={'confirm-icon ' + (confirm === '淘汰' ? 'red' : '')}>
                {confirm === '录用' ? (
                  <CheckCircle2 />
                ) : confirm === '淘汰' ? (
                  <XCircle />
                ) : (
                  <Clock />
                )}
              </span>
              <h3 id="confirm-title">
                将 {draft.name || '这位同学'} 标记为{confirm}？
              </h3>
              <p>
                {draft.className || '班级未填'} · {draft.studentId || '学号未填'}
              </p>
              <p className="helper">本次面试评价会一起保存。结果可以在操作记录中撤回。</p>
              <div className="button-row">
                <button className="btn secondary" onClick={() => setConfirm(null)} disabled={busy}>
                  再考虑一下
                </button>
                <button
                  className={'btn ' + (confirm === '淘汰' ? 'danger' : '')}
                  disabled={busy}
                  onClick={() => save(confirm)}
                >
                  {busy ? <Loader2 className="spin" size={16} /> : <Check size={16} />}确认{confirm}
                </button>
              </div>
            </div>
          </div>
        )}
        {preview && (
          <div className="material-preview">
            <header>
              <strong>{preview.name}</strong>
              <button
                className="icon-btn"
                onClick={() => setPreview(null)}
                aria-label="关闭材料预览"
              >
                <X />
              </button>
            </header>
            {preview.type === 'application/pdf' ? (
              <PdfPreview url={'/api/files/' + preview.id} />
            ) : preview.type.startsWith('image/') ? (
              <img alt={preview.name} src={'/api/files/' + preview.id} />
            ) : (
              <iframe title={preview.name} src={'/api/files/' + preview.id} />
            )}
            <a
              className="btn secondary"
              href={'/api/files/' + preview.id}
              target="_blank"
              rel="noopener noreferrer"
            >
              在新窗口打开
              <ArrowUpRight size={16} />
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
