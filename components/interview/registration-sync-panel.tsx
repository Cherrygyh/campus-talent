'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import type { RegistrationSyncStatus } from '../../lib/registration-sync-store';
import { editorHeaders } from './collaboration';

const time = (value?: string) => (value ? new Date(value).toLocaleString('zh-CN') : '尚未同步');
export default function RegistrationSyncPanel({ refresh }: { refresh: () => Promise<void> }) {
  const [status, setStatus] = useState<RegistrationSyncStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/registration-sync', { cache: 'no-store' });
      if (!response.ok) throw new Error('同步状态暂时无法读取');
      setStatus(await response.json());
      setError('');
    } catch (error) {
      setError((error as Error).message);
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const interval = setInterval(() => void load(), 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [load]);
  async function sync() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/registration-sync', {
        method: 'POST',
        headers: editorHeaders(),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || '同步未完成');
      setStatus(result);
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const issue = error || status?.error;
  return (
    <section className="surface registration-sync">
      <div className="row-between">
        <div>
          <h3>腾讯文档自动同步</h3>
          <p className="helper">
            新报名和报名资料的修改会自动更新，面试评分、状态、备注和附件会保留。
          </p>
        </div>
        <button
          className="btn secondary"
          onClick={sync}
          disabled={!status?.enabled || busy || status.running}
        >
          {busy || status?.running ? (
            <Loader2 className="spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          {busy || status?.running ? '正在同步…' : '立即同步'}
        </button>
      </div>
      {!status && !error && <p className="helper">正在读取同步状态…</p>}
      {status && !status.configured && (
        <p className="helper">等待在服务器配置腾讯文档授权后启用。</p>
      )}
      {status?.configured && (
        <>
          <div className="sync-details">
            <span>
              <strong>{status.enabled ? '已开启定时同步' : '同步已暂停'}</strong>
            </span>
            <span>最近成功：{time(status.lastSuccessAt)}</span>
            {status.nextRunAt && <span>下次同步：{time(status.nextRunAt)}</span>}
          </div>
          {status.source && (
            <a href={status.source} target="_blank" rel="noreferrer">
              查看腾讯文档来源
            </a>
          )}
          {status.counts && (
            <p className="helper">
              上次结果：新增 {status.counts.added} 人 · 更新 {status.counts.updated} 人 · 已关联{' '}
              {status.counts.linked} 人 · 无变化 {status.counts.unchanged} 人
              {!!status.counts.duplicates && ` · 合并完全重复答卷 ${status.counts.duplicates} 条`}
            </p>
          )}
          {!!status.conflictCount && (
            <div className="alert error">
              <AlertCircle size={18} />有 {status.conflictCount} 处资料差异待核对，已保留本地内容。
            </div>
          )}
          {status.lastSuccessAt && !issue && !status.conflictCount && (
            <div className="info-strip">
              <CheckCircle2 size={17} />
              报名资料已连接，关闭网页后服务器仍会自动同步。
            </div>
          )}
        </>
      )}
      {issue && (
        <div className="alert error" role="alert">
          <AlertCircle size={18} />
          {issue}
        </div>
      )}
    </section>
  );
}
