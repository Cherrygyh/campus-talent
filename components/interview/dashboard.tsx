'use client';
import { APP_VERSION } from '../../lib/version';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Users,
  LayoutGrid,
  Upload,
  Settings2,
  History,
  ChevronDown,
  ArrowUpRight,
  Plus,
  Download,
  CheckCircle2,
  Clock,
  UserCheck,
  RefreshCw,
  ArrowRight,
  Menu,
  X,
  Loader2,
  Undo2,
  FileSpreadsheet,
  MoreHorizontal,
  FolderOpen,
  Check,
  ShieldCheck,
  ClipboardList,
} from 'lucide-react';
import {
  Candidate,
  Snapshot,
  Status,
  STATUSES,
  newCandidate,
  norm,
  totalScore,
  csvCell,
  DEFAULT_CONFIG,
} from '../../lib/talent';
import {
  useCollaboration,
  CollaborationBadge,
  CollaborationGate,
  editorHeaders,
} from './collaboration';
import ImportPanel from './import-panel';
import CandidatePanel from './candidate-panel';
import SettingsPanel from './settings-panel';
type Page = 'list' | 'board' | 'import' | 'settings' | 'history';
const PAGE_TITLES: Record<Page, string> = {
  list: '报名名单',
  board: '面试看板',
  import: '数据导入',
  settings: '工作台设置',
  history: '操作记录',
};
const NAV = [
  { id: 'list' as Page, label: '报名名单', icon: Users },
  { id: 'board' as Page, label: '面试看板', icon: LayoutGrid },
  { id: 'import' as Page, label: '数据导入', icon: Upload },
  { id: 'settings' as Page, label: '工作台设置', icon: Settings2 },
  { id: 'history' as Page, label: '操作记录', icon: History },
];
const emptyState: Snapshot = {
  revision: 0,
  config: DEFAULT_CONFIG,
  candidates: [],
  attachments: [],
  events: [],
};
export default function Dashboard({ userName: initialName }: { userName: string }) {
  const [userName, setUserName] = useState(initialName);
  useEffect(() => {
    const name = localStorage.getItem('shicai-interviewer');
    if (name) setUserName(name);
  }, []);
  const collaboration = useCollaboration(userName);
  const [state, setState] = useState<Snapshot>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState<Page>('list');
  const [batch, setBatch] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('全部');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('created');
  const [selected, setSelected] = useState<string[]>([]);
  const [active, setActive] = useState<Candidate | null>(null);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [more, setMore] = useState(false);
  const [bulk, setBulk] = useState<Status | null>(null);
  const [reason, setReason] = useState('');
  const [limit, setLimit] = useState(50);
  const search = useRef<HTMLInputElement>(null);
  const backupPicker = useRef<HTMLInputElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef(false);
  const revisionRef = useRef(0);
  const notify = useCallback((text: string) => {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 5500);
  }, []);
  const refresh = useCallback(async () => {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const d = (await r.json()) as Snapshot & { error?: string; message?: string };
    if (!r.ok) throw new Error(d.error || '读取失败');
    revisionRef.current = d.revision;
    setState(d);
    setBatch((previous) =>
      previous && d.config.batches.some((b: { id: string }) => b.id === previous)
        ? previous
        : d.config.batches[0].id,
    );
    setError('');
  }, []);
  useEffect(() => {
    refresh()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (!active && !saving && !inflight.current && ['list', 'board', 'history'].includes(page))
        refresh().catch(() => {});
    }, 20000);
    return () => clearInterval(timer);
  }, [active, saving, page, refresh]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        !active &&
        !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) &&
        (e.key === '/' || (e.key === 'k' && (e.ctrlKey || e.metaKey)))
      ) {
        e.preventDefault();
        setPage('list');
        search.current?.focus();
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [active]);
  useEffect(() => {
    setLimit(50);
    setSelected([]);
  }, [batch, direction, status, query, page]);
  async function mutate(body: Record<string, unknown>): Promise<Snapshot> {
    if (inflight.current) throw new Error('正在保存上一项操作，请稍候');
    inflight.current = true;
    setSaving(true);
    try {
      const r = await fetch('/api/state', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...editorHeaders(),
          'x-interviewer-name': encodeURIComponent(userName),
        },
        body: JSON.stringify({ ...body, revision: revisionRef.current }),
      });
      const d = (await r.json()) as Snapshot & { error?: string; message?: string };
      if (!r.ok) {
        if (r.status === 409) await refresh();
        throw new Error(d.error || '保存失败');
      }
      revisionRef.current = d.revision;
      setState(d);
      notify(d.message || '已保存');
      return d;
    } finally {
      inflight.current = false;
      setSaving(false);
    }
  }
  const batchPeople = state.candidates.filter((c) => c.batch === batch);
  const filtered = useMemo(() => {
    const words = query.trim().split(/\s+/).map(norm).filter(Boolean);
    const list = state.candidates.filter(
      (c) =>
        c.batch === batch &&
        (!direction || c.direction === direction) &&
        (status === '全部' || c.status === status) &&
        words.every((q) =>
          norm(
            [
              c.name,
              c.className,
              c.studentId,
              c.phone,
              c.email,
              c.notes,
              Object.values(c.extra).join(' '),
            ].join(' '),
          ).includes(q),
        ),
    );
    return list.sort((a, b) =>
      sort === 'score'
        ? (totalScore(b, state.config) ?? -1) - (totalScore(a, state.config) ?? -1)
        : sort === 'name'
          ? a.name.localeCompare(b.name, 'zh-CN')
          : sort === 'updated'
            ? b.updatedAt.localeCompare(a.updatedAt)
            : a.createdAt.localeCompare(b.createdAt),
    );
  }, [state, batch, direction, status, query, sort]);
  const sameName = query.trim() ? filtered.filter((c) => norm(c.name) === norm(query)) : [];
  const stats = [
    {
      label: '报名总人数',
      count: batchPeople.length,
      sub: '当前招新批次',
      icon: Users,
      color: 'gray',
    },
    {
      label: '等待面试',
      count: batchPeople.filter((c) => c.status === '待面试').length,
      sub: '等一次认真交流',
      icon: Clock,
      color: 'amber',
    },
    {
      label: '已确认录用',
      count: batchPeople.filter((c) => c.status === '录用').length,
      sub: '准备一起做点什么',
      icon: UserCheck,
      color: 'green',
    },
    {
      label: '已完成面试',
      count: batchPeople.filter((c) => ['录用', '淘汰', '候补'].includes(c.status)).length,
      sub: '含录用、候补与淘汰',
      icon: CheckCircle2,
      color: 'blue',
    },
  ];
  function go(p: Page) {
    setPage(p);
    setSidebar(false);
    setMore(false);
  }
  function download(name: string, content: string, type: string) {
    const u = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
  function exportCsv() {
    const people = selected.length ? filtered.filter((c) => selected.includes(c.id)) : filtered;
    const headers = [
      '姓名',
      '班级',
      '学号',
      '电话',
      '邮箱',
      '面试状态',
      '总分',
      '面试官',
      '面试评价',
      ...state.config.rubric.map((r) => r.label + '（0–10）'),
      '原报名表内容',
    ];
    const rows = people.map((c) => [
      c.name,
      c.className,
      c.studentId,
      c.phone,
      c.email,
      c.status,
      totalScore(c, state.config) ?? '',
      c.interviewer,
      c.notes,
      ...state.config.rubric.map((r) => c.scores[r.id] ?? ''),
      JSON.stringify(c.extra),
    ]);
    download(
      '招新名单_' + new Date().toISOString().slice(0, 10) + '.csv',
      '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n'),
      'text/csv;charset=utf-8',
    );
    notify(`已导出 ${people.length} 位同学的名单`);
    setMore(false);
  }
  function backup() {
    download(
      '拾才_数据备份_' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify(
        { format: 'campus-talent-v1', exportedAt: new Date().toISOString(), ...state },
        null,
        2,
      ),
      'application/json',
    );
    notify('已备份报名与面试结果；附件文件请另行下载');
    setMore(false);
  }
  async function restore(input: FileList | null) {
    if (!input?.[0]) return;
    try {
      const file = input[0];
      if (file.size > 1500000) throw new Error('备份超过单次恢复大小，请先将名单分批导入');
      const d = JSON.parse(await file.text());
      if (d.format !== 'campus-talent-v1') throw new Error('请选择本工作台导出的 JSON 备份');
      if (
        !window.confirm(
          '将备份里的报名合并到当前工作台，重复报名会跳过。附件文件不会自动恢复。确认继续？',
        )
      )
        return;
      await mutate({ op: 'restore', config: d.config, candidates: d.candidates });
    } catch (e) {
      notify((e as Error).message);
    } finally {
      if (backupPicker.current) backupPicker.current.value = '';
    }
  }
  async function demo() {
    if (!window.confirm('加载 8 条带“示例”标记的虚拟报名，用来体验面试流程？稍后可以一键清除。'))
      return;
    const labels = [
      '示例·林同学',
      '示例·陈同学',
      '示例·周同学',
      '示例·许同学',
      '示例·林同学',
      '示例·沈同学',
      '示例·王同学',
      '示例·吴同学',
    ];
    const candidates = labels.map((name, i) =>
      newCandidate(state.config, {
        name,
        className: ['软件2401', '计算机2402', '数媒2401'][i % 3],
        studentId: 'P90000000' + i,
        batch: batch || state.config.batches[0].id,
        status: (
          ['待面试', '录用', '候补', '待面试', '待面试', '淘汰', '面试中', '待面试'] as Status[]
        )[i],
        demo: true,
        scores: i % 3 === 1 ? Object.fromEntries(state.config.rubric.map((r) => [r.id, 8])) : {},
        notes: i === 1 ? '示例评价：表达清晰，愿意参与团队项目。' : '',
        source: '内置示例数据',
        extra: { 自我介绍: '这是演示内容，可一键清除。' },
      }),
    );
    try {
      await mutate({ op: 'import', candidates });
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function executeBulk() {
    if (!bulk) return;
    try {
      await mutate({ op: 'bulk', ids: selected, status: bulk, reason });
      setBulk(null);
      setSelected([]);
      setReason('');
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function saveCandidate(c: Candidate) {
    await mutate({ op: 'save', candidate: c, expectedUpdatedAt: active?.updatedAt });
  }
  if (loading)
    return (
      <div className="loading-screen">
        <span className="brand-mark">拾</span>
        <h2>正在打开面试工作台</h2>
        <Loader2 className="spin" />
        <p>读取报名信息与面试记录…</p>
      </div>
    );
  return (
    <>
      <div className="app-shell" inert={collaboration.phase !== 'active'}>
        {sidebar && <div className="sidebar-shade" onClick={() => setSidebar(false)} />}
        <aside className={'sidebar ' + (sidebar ? 'open' : '')}>
          <a className="brand" href="/" aria-label="拾才首页">
            <span className="brand-mark">拾</span>
            <div>
              <strong>
                拾才<span>SHICAI</span>
              </strong>
              <small>招新面试工作台</small>
            </div>
          </a>
          <div className="workspace-label">
            <span className="workspace-icon">
              <GraduationCapIcon />
            </span>
            <div>
              <strong>{state.config.title}</strong>
              <small>面试官工作空间</small>
            </div>
            <ShieldCheck size={15} />
          </div>
          <span className="nav-label">工作台</span>
          <nav>
            {NAV.map((n) => (
              <button
                key={n.id}
                className={page === n.id ? 'nav-item active' : 'nav-item'}
                onClick={() => go(n.id)}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.id === 'list' && <small>{batchPeople.length}</small>}
                {n.id === 'import' && <span className="nav-dot" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="little-spark">✦</span>
              <strong>见面，是了解的开始。</strong>
              <p>
                资料用来找到人，
                <br />
                决定留给真实的交流。
              </p>
            </div>
            <div className="profile">
              <span className="profile-avatar">{userName.slice(0, 1).toUpperCase()}</span>
              <label>
                面试官姓名
                <input
                  aria-label="面试官姓名"
                  placeholder="填写你的名字"
                  value={userName === '面试官' ? '' : userName}
                  maxLength={80}
                  onChange={(e) => {
                    const value = e.target.value;
                    setUserName(value);
                    localStorage.setItem('shicai-interviewer', value);
                  }}
                />
              </label>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-btn mobile-menu"
                aria-label="打开导航"
                onClick={() => setSidebar(true)}
              >
                <Menu />
              </button>
              <span>{state.config.title}</span>
              <span>/</span>
              <strong>{PAGE_TITLES[page]}</strong>
            </div>
            <div className="topbar-actions">
              <CollaborationBadge session={collaboration} />
              <span className="sync-label">
                <span className={'sync-dot ' + (saving ? 'saving' : '')} />
                {saving ? '正在保存…' : '云端工作台'}
              </span>
              <button
                className="icon-btn"
                aria-label="刷新数据"
                disabled={saving}
                onClick={() =>
                  refresh()
                    .then(() => notify('已刷新最新名单'))
                    .catch((e) => notify(e.message))
                }
              >
                <RefreshCw size={16} />
              </button>
              <label className="top-interviewer">
                <input
                  aria-label="当前面试官姓名"
                  placeholder="你的名字"
                  value={userName === '面试官' ? '' : userName}
                  maxLength={80}
                  onChange={(e) => {
                    setUserName(e.target.value);
                    localStorage.setItem('shicai-interviewer', e.target.value);
                  }}
                />
              </label>
            </div>
          </header>
          <main className="main-content">
            {error && (
              <div className="alert error" role="alert">
                {error}
                <button
                  className="text-btn"
                  onClick={() => refresh().catch((e) => setError(e.message))}
                >
                  重试
                </button>
              </div>
            )}
            {['list', 'board'].includes(page) && (
              <>
                <div className="page-heading">
                  <div>
                    <span className="eyebrow">RECRUITMENT / 面试现场</span>
                    <h1>{page === 'list' ? '今天，遇见新的伙伴。' : '每一步，都心中有数。'}</h1>
                    <p>找到这位同学，打开报名表，记录这次见面的判断。</p>
                  </div>
                  <button className="btn" onClick={() => go('import')}>
                    <Plus size={17} />
                    导入报名
                  </button>
                </div>
                <div className="batch-row">
                  <label className="batch-select">
                    <ClipboardList size={15} />
                    <select
                      aria-label="当前招新批次"
                      value={batch}
                      onChange={(e) => setBatch(e.target.value)}
                    >
                      {state.config.batches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </label>
                  <span className="muted">信息与结果自动保存到云端</span>
                </div>
                <div className="stats-grid">
                  {stats.map((s) => (
                    <div className={'stat-card ' + s.color} key={s.label}>
                      <div>
                        <span>{s.label}</span>
                        <strong>{s.count.toString().padStart(2, '0')}</strong>
                        <small>{s.sub}</small>
                      </div>
                      <span className="stat-icon">
                        <s.icon size={22} />
                      </span>
                    </div>
                  ))}
                </div>
                <section className="search-area">
                  <div className="search-illustration">
                    <Search size={30} />
                    <span className="search-dot" />
                  </div>
                  <div className="search-copy">
                    <h3>这位同学，叫什么名字？</h3>
                    <p>姓名、学号、班级、电话都能找到。</p>
                  </div>
                  <div className="search-field">
                    <Search size={19} />
                    <input
                      ref={search}
                      value={query}
                      placeholder="输入姓名 / 学号，快速打开报名表"
                      aria-label="搜索报名信息"
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' &&
                          (sameName.length === 1 || (!sameName.length && filtered.length === 1))
                        )
                          setActive(sameName[0] || filtered[0]);
                      }}
                    />
                    {query ? (
                      <button
                        className="icon-btn"
                        aria-label="清空搜索"
                        onClick={() => setQuery('')}
                      >
                        <X size={16} />
                      </button>
                    ) : (
                      <kbd>/</kbd>
                    )}
                  </div>
                </section>
                {sameName.length > 1 && (
                  <div className="alert warning">
                    <Users size={17} />有 {sameName.length} 位同名同学，请按班级或学号核对后打开。
                  </div>
                )}
              </>
            )}
            {page === 'list' && (
              <section className="surface candidate-list">
                <div className="list-toolbar">
                  <div className="status-tabs">
                    {['全部', '待面试', '面试中', '候补', '录用', '淘汰', '缺席'].map((s) => (
                      <button
                        key={s}
                        className={status === s ? 'active' : ''}
                        onClick={() => setStatus(s)}
                      >
                        {s}
                        <small>
                          {s === '全部'
                            ? batchPeople.length
                            : batchPeople.filter((c) => c.status === s).length}
                        </small>
                      </button>
                    ))}
                  </div>
                  <div className="list-actions">
                    <button
                      className="icon-btn"
                      title="手动新增报名"
                      aria-label="手动新增报名"
                      onClick={() => setActive(newCandidate(state.config, { batch }))}
                    >
                      <Plus size={19} />
                    </button>
                    <div className="more-wrap">
                      <button
                        className="icon-btn"
                        aria-label="导出和备份"
                        onClick={() => setMore(!more)}
                      >
                        <MoreHorizontal size={20} />
                      </button>
                      {more && (
                        <div className="dropdown">
                          <button onClick={exportCsv}>
                            <Download size={15} />
                            导出当前名单 CSV
                          </button>
                          <button onClick={backup}>
                            <FolderOpen size={15} />
                            备份报名与结果 JSON
                          </button>
                          <button
                            onClick={() => {
                              backupPicker.current?.click();
                              setMore(false);
                            }}
                          >
                            <Upload size={15} />从 JSON 备份恢复
                          </button>
                          {state.candidates.some((c) => c.demo) && (
                            <button
                              onClick={() => {
                                if (
                                  window.confirm('清除全部带“示例”标记的报名？真实报名不会受影响。')
                                )
                                  mutate({ op: 'clearDemo' }).catch((e) => notify(e.message));
                                setMore(false);
                              }}
                            >
                              <X size={15} />
                              清除示例数据
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="filter-row">
                  <span className="muted">
                    共 {filtered.length} 位同学{query && '符合搜索'}
                  </span>
                  <div>
                    <select
                      aria-label="名单排序"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="created">报名时间</option>
                      <option value="name">姓名排序</option>
                      <option value="updated">最近更新</option>
                      <option value="score">评分从高到低</option>
                    </select>
                  </div>
                </div>
                {selected.length > 0 && (
                  <div className="selection-bar">
                    <span>
                      已选择 <strong>{selected.length}</strong> 人
                    </span>
                    <button className="text-btn" onClick={() => setSelected([])}>
                      取消
                    </button>
                    <div />
                    <button
                      onClick={() => {
                        setBulk('候补');
                        setReason('');
                      }}
                    >
                      候补
                    </button>
                    <button
                      onClick={() => {
                        setBulk('淘汰');
                        setReason('');
                      }}
                    >
                      淘汰
                    </button>
                    <button
                      onClick={() => {
                        setBulk('录用');
                        setReason('');
                      }}
                    >
                      录用
                    </button>
                    <button onClick={exportCsv}>导出</button>
                  </div>
                )}
                {filtered.length > 0 ? (
                  <>
                    <div className="table-scroll">
                      <table className="people-table">
                        <thead>
                          <tr>
                            <th className="checkbox-cell">
                              <input
                                type="checkbox"
                                aria-label="选择当前显示的全部报名"
                                checked={filtered
                                  .slice(0, limit)
                                  .every((c) => selected.includes(c.id))}
                                onChange={(e) =>
                                  setSelected(
                                    e.target.checked
                                      ? Array.from(
                                          new Set([
                                            ...selected,
                                            ...filtered.slice(0, limit).map((c) => c.id),
                                          ]),
                                        )
                                      : selected.filter(
                                          (id) =>
                                            !filtered.slice(0, limit).some((c) => c.id === id),
                                        ),
                                  )
                                }
                              />
                            </th>
                            <th>报名人</th>
                            <th>班级 / 学号</th>
                            <th>面试状态</th>
                            <th>面试评分</th>
                            <th>报名材料</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.slice(0, limit).map((c, i) => {
                            const score = totalScore(c, state.config);
                            const files = state.attachments.filter((a) => a.candidateId === c.id);
                            return (
                              <tr
                                key={c.id}
                                onClick={() => setActive(c)}
                                className={selected.includes(c.id) ? 'selected' : ''}
                              >
                                <td className="checkbox-cell" onClick={(e) => e.stopPropagation()}>
                                  <input
                                    type="checkbox"
                                    aria-label={'选择 ' + c.name + ' ' + c.studentId}
                                    checked={selected.includes(c.id)}
                                    onChange={(e) =>
                                      setSelected(
                                        e.target.checked
                                          ? [...selected, c.id]
                                          : selected.filter((id) => id !== c.id),
                                      )
                                    }
                                  />
                                </td>
                                <td>
                                  <button
                                    className="person-cell"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActive(c);
                                    }}
                                  >
                                    <span className={'avatar avatar-' + (i % 4)}>
                                      {c.name.replace('示例·', '').slice(0, 1)}
                                    </span>
                                    <span>
                                      <strong>{c.name}</strong>
                                      <small>
                                        {c.demo ? '示例数据' : c.phone || c.email || '联系方式未填'}
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>
                                  <div className="stack-cell">
                                    <span>{c.className || '未填写'}</span>
                                    <small className="mono">{c.studentId || '学号未填写'}</small>
                                  </div>
                                </td>
                                <td>
                                  <span className={'status status-' + c.status}>
                                    <i />
                                    {c.status}
                                  </span>
                                </td>
                                <td>
                                  {score == null ? (
                                    <span className="muted">未评分</span>
                                  ) : (
                                    <strong className="table-score">
                                      {score}
                                      <small>/100</small>
                                    </strong>
                                  )}
                                </td>
                                <td>
                                  <span className="material-count">
                                    <FileSpreadsheet size={14} />
                                    报名表{files.length > 0 && <small>+{files.length}</small>}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="open-row"
                                    aria-label={'打开 ' + c.name + ' ' + c.studentId}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActive(c);
                                    }}
                                  >
                                    查看
                                    <ArrowUpRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="table-footer">
                      <span>
                        已显示 {Math.min(limit, filtered.length)} / {filtered.length} 人
                      </span>
                      {limit < filtered.length ? (
                        <button className="text-btn" onClick={() => setLimit(limit + 50)}>
                          再显示 50 人<ChevronDown size={14} />
                        </button>
                      ) : (
                        <span>
                          点击一行，开始面试
                          <ArrowRight size={13} />
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-art">
                      <div />
                      <ClipboardList size={44} />
                      <span>
                        <Search size={19} />
                      </span>
                    </div>
                    <h3>
                      {state.candidates.length || query
                        ? '没有找到这位同学'
                        : '第一位新伙伴，从这里开始'}
                    </h3>
                    <p>
                      {query
                        ? '换个名字、学号或班级试试，也可以清除筛选条件。'
                        : '导入纳新群收集的报名表，面试时搜索姓名即可打开资料。'}
                    </p>
                    <div className="button-row">
                      <button
                        className="btn"
                        onClick={() =>
                          query || state.candidates.length
                            ? (setQuery(''), setStatus('全部'), setDirection(''))
                            : go('import')
                        }
                      >
                        {query || state.candidates.length ? '清除筛选' : '导入报名表'}
                        <ArrowRight size={16} />
                      </button>
                      {!state.candidates.length && (
                        <button className="btn secondary" onClick={demo}>
                          先用示例体验
                        </button>
                      )}
                    </div>
                    <small>姓名、班级、学号、电话、邮箱足以开始。</small>
                  </div>
                )}
              </section>
            )}
            {page === 'board' && (
              <>
                <div className="board">
                  {STATUSES.map((s) => (
                    <section className="board-column" key={s}>
                      <h3>
                        <span className={'status-dot dot-' + s} />
                        {s}
                        <small>{filtered.filter((c) => c.status === s).length}</small>
                      </h3>
                      {filtered
                        .filter((c) => c.status === s)
                        .map((c) => (
                          <button className="board-card" key={c.id} onClick={() => setActive(c)}>
                            <div className="row-between">
                              <strong>{c.name}</strong>
                              <ArrowUpRight size={14} />
                            </div>
                            <p>{c.className || '班级未填'}</p>
                            <small className="mono">{c.studentId || '学号未填'}</small>
                            <footer>
                              <span className="helper">{c.demo ? '示例' : '报名表'}</span>
                              <strong>
                                {totalScore(c, state.config) ?? '—'}
                                <small>分</small>
                              </strong>
                            </footer>
                          </button>
                        ))}
                      {!filtered.some((c) => c.status === s) && (
                        <div className="board-empty">暂无同学</div>
                      )}
                    </section>
                  ))}
                </div>
              </>
            )}
            {page === 'import' && (
              <ImportPanel state={state} mutate={mutate} refresh={refresh} notify={notify} />
            )}
            {page === 'settings' && (
              <SettingsPanel
                initial={state.config}
                onSave={(config, expected) =>
                  mutate({ op: 'settings', config, expectedConfig: expected }).then(() => {})
                }
              />
            )}
            {page === 'history' && (
              <div className="history-page">
                <div className="section-heading">
                  <div>
                    <span className="eyebrow">每一次判断都有记录</span>
                    <h2>操作记录</h2>
                    <p>最近 100 次操作。撤回会检查后续修改，保护新的面试评价。</p>
                  </div>
                  <History className="heading-icon" />
                </div>
                <section className="surface history-list">
                  {state.events.length ? (
                    state.events.map((e) => (
                      <div className="history-item" key={e.id}>
                        <span className="history-icon">
                          {e.undone ? <Undo2 size={18} /> : <Check size={18} />}
                        </span>
                        <div>
                          <strong>{e.summary}</strong>
                          <small>
                            {e.actor} ·{' '}
                            {new Date(e.time).toLocaleString('zh-CN', {
                              timeZone: 'Asia/Shanghai',
                            })}
                            {e.undone && ' · 已撤回'}
                          </small>
                        </div>
                        {e.undoable && !e.undone && (
                          <button
                            className="btn secondary small"
                            disabled={saving}
                            onClick={() => {
                              if (
                                window.confirm(
                                  '确认撤回“' +
                                    e.summary +
                                    '”？如记录已有后续修改，本次撤回会被阻止。',
                                )
                              )
                                mutate({ op: 'undo', eventId: e.id }).catch((err) =>
                                  notify(err.message),
                                );
                            }}
                          >
                            <Undo2 size={14} />
                            撤回
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="empty-small">
                      <History size={30} />
                      <p>保存报名或面试结果后，记录会出现在这里。</p>
                    </div>
                  )}
                </section>
              </div>
            )}
            <footer className="app-footer">
              <span>
                <span className="mini-brand">拾</span>拾才 · 招新面试工作台{' '}
                <small>v{APP_VERSION}</small>
              </span>
              <span>资料找到人，见面了解人。</span>
            </footer>
          </main>
        </div>
        <input
          ref={backupPicker}
          type="file"
          accept=".json"
          hidden
          onChange={(e) => restore(e.target.files)}
        />
        {active && (
          <CandidatePanel
            key={active.id}
            candidate={active}
            config={state.config}
            attachments={state.attachments.filter((a) => a.candidateId === active.id)}
            userName={userName}
            onClose={() => setActive(null)}
            onSave={saveCandidate}
            refresh={refresh}
            notify={notify}
          />
        )}
        {bulk && (
          <div
            className="overlay"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !saving) setBulk(null);
            }}
          >
            <div
              className="bulk-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="bulk-title"
            >
              <div className="row-between">
                <h3 id="bulk-title">
                  将 {selected.length} 位同学标记为{bulk}
                </h3>
                <button
                  className="icon-btn"
                  disabled={saving}
                  onClick={() => setBulk(null)}
                  aria-label="取消批量操作"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="helper">请核对名单后确认。每位同学的面试记录会保留，可撤回本次操作。</p>
              <div className="bulk-names">
                {state.candidates
                  .filter((c) => selected.includes(c.id))
                  .map((c) => (
                    <span className="tag" key={c.id}>
                      {c.name} · {c.className}
                    </span>
                  ))}
              </div>
              <label>
                结果备注（选填）
                <textarea
                  rows={3}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="记录本次批量处理的原因…"
                />
              </label>
              <div className="button-row">
                <button className="btn secondary" disabled={saving} onClick={() => setBulk(null)}>
                  取消
                </button>
                <button
                  className={'btn ' + (bulk === '淘汰' ? 'danger' : '')}
                  disabled={saving}
                  onClick={executeBulk}
                >
                  {saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}确认{bulk}
                </button>
              </div>
            </div>
          </div>
        )}
        {toast && (
          <div className="toast" role="status">
            <CheckCircle2 size={18} />
            {toast}
            <button className="icon-btn" onClick={() => setToast('')} aria-label="关闭提示">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
      {collaboration.phase !== 'active' && <CollaborationGate session={collaboration} />}
    </>
  );
}
function GraduationCapIcon() {
  return <ClipboardList size={17} />;
}
