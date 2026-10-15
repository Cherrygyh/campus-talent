'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Users, RefreshCw, LogOut } from 'lucide-react';
import { MAX_EDITORS, Presence } from '../../lib/presence';
type Phase = 'joining' | 'active' | 'full' | 'paused' | 'error';
let identity: { sessionId: string; clientId: string } | null = null;
export function editorHeaders(): Record<string, string> {
  return identity
    ? { 'x-editor-session': identity.sessionId, 'x-editor-client': identity.clientId }
    : {};
}
export function useCollaboration(name: string) {
  const [phase, setPhase] = useState<Phase>('joining');
  const [presence, setPresence] = useState<Presence>({ limit: MAX_EDITORS, count: 0, members: [] });
  const [error, setError] = useState('');
  const action = useRef<() => void>(() => {});
  const release = useRef<() => void>(() => {});
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  }, [name]);
  useEffect(() => {
    let stopped = false,
      paused = false;
    let chain = Promise.resolve();
    let cid: string;
    try {
      cid = localStorage.getItem('shicai-client-id') || crypto.randomUUID();
      localStorage.setItem('shicai-client-id', cid);
    } catch {
      cid = crypto.randomUUID();
    }
    const localIdentity = { clientId: cid, sessionId: crypto.randomUUID() };
    identity = localIdentity;
    const payload = (op: string) => JSON.stringify({ ...localIdentity, name: nameRef.current, op });
    async function check() {
      if (stopped) return;
      const wasPaused = paused;
      try {
        const r = await fetch(
          '/api/presence',
          wasPaused
            ? { cache: 'no-store', signal: AbortSignal.timeout(10_000) }
            : {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload('join'),
                signal: AbortSignal.timeout(10_000),
              },
        );
        const d = (await r.json()) as Presence & { admitted?: boolean; error?: string };
        if (stopped || wasPaused !== paused) return;
        if (!r.ok && r.status !== 429) throw new Error(d.error || '协作连接暂时不可用');
        setPresence(d);
        setError('');
        setPhase(paused ? 'paused' : d.admitted ? 'active' : 'full');
      } catch (e) {
        if (!stopped && wasPaused === paused) {
          setError((e as Error).message);
          setPhase('error');
        }
      }
    }
    function schedule(fn: () => Promise<void>) {
      chain = chain.then(fn, fn);
      return chain;
    }
    function beaconLeave() {
      navigator.sendBeacon(
        '/api/presence',
        new Blob([payload('leave')], { type: 'application/json' }),
      );
    }
    action.current = () => {
      paused = false;
      setPhase('joining');
      void schedule(check);
    };
    release.current = () => {
      paused = true;
      setPhase('paused');
      void schedule(async () => {
        try {
          await fetch('/api/presence', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: payload('leave'),
            signal: AbortSignal.timeout(10_000),
          });
        } catch {}
        await check();
      });
    };
    const pageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        paused = false;
        void schedule(check);
      }
    };
    void schedule(check);
    const timer = setInterval(() => void schedule(check), 15_000);
    window.addEventListener('pagehide', beaconLeave);
    window.addEventListener('pageshow', pageShow);
    return () => {
      stopped = true;
      clearInterval(timer);
      window.removeEventListener('pagehide', beaconLeave);
      window.removeEventListener('pageshow', pageShow);
      beaconLeave();
      if (identity === localIdentity) identity = null;
    };
  }, []);
  const retry = useCallback(() => action.current(), []);
  const leave = useCallback(() => release.current(), []);
  return { phase, presence, error, retry, leave };
}
export type Collaboration = ReturnType<typeof useCollaboration>;
export function CollaborationBadge({ session }: { session: Collaboration }) {
  return (
    <div className="collaboration-badge">
      <span title={session.presence.members.map((x) => x.name).join('、')}>
        <Users size={14} />
        在线 {session.presence.count}/{session.presence.limit}
      </span>
      <button
        className="icon-btn"
        aria-label="离开协作并释放席位"
        title="离开协作并释放席位"
        onClick={session.leave}
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
export function CollaborationGate({ session }: { session: Collaboration }) {
  return (
    <div
      className="collaboration-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="collaboration-title"
    >
      <section className="surface">
        <span className="collaboration-emblem">
          {session.phase === 'joining' ? (
            <Loader2 className="spin" size={30} />
          ) : (
            <Users size={30} />
          )}
        </span>
        <h2 id="collaboration-title">
          {session.phase === 'joining'
            ? '正在加入面试工作台'
            : session.phase === 'full'
              ? '5 个编辑席位已满'
              : session.phase === 'paused'
                ? '你已离开协作'
                : '协作连接暂时中断'}
        </h2>
        <p>
          {session.phase === 'full'
            ? '最多允许 5 位面试官同时编辑。有人离开后，本页会自动尝试加入。'
            : session.phase === 'paused'
              ? '当前席位已释放，需要继续面试时可重新进入。'
              : session.phase === 'error'
                ? session.error
                : '正在同步在线面试官，请稍候…'}
        </p>
        {!!session.presence.members.length && (
          <div className="online-names">
            {session.presence.members.map((x, i) => (
              <span className="tag" key={i}>
                {x.name}
              </span>
            ))}
          </div>
        )}
        <small>
          同一浏览器的多个标签页共用 1 个名额；关闭页面后释放，异常断线最长约 60 秒回收。
        </small>
        {session.phase !== 'joining' && (
          <button className="btn" onClick={session.retry}>
            <RefreshCw size={16} />
            {session.phase === 'paused' ? '重新进入' : '立即重试'}
          </button>
        )}
      </section>
    </div>
  );
}
