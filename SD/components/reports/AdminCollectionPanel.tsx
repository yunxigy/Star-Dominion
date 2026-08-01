import { useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';

import { useAuth } from '../../context/AuthContext';
import { getCollectionRun, startCollection } from '../../lib/researchReports';


const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function AdminCollectionPanel({ onCompleted }: { onCompleted: () => Promise<void> | void }) {
  const { user } = useAuth();
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState('');
  if (user?.role !== 'admin') return null;

  const refresh = async () => {
    setRunning(true);
    setMessage('已提交采集任务');
    try {
      const started = await startCollection();
      const runId = started.runId || started.id;
      if (!runId) throw new Error('采集任务缺少运行编号');
      const deadline = Date.now() + 180_000;
      while (Date.now() < deadline) {
        await wait(2_000);
        const run = await getCollectionRun(runId);
        if (run.status !== 'running') {
          setMessage(run.status === 'success' ? '采集完成' : run.status === 'partial' ? '部分榜单已更新' : '采集失败');
          await onCompleted();
          return;
        }
      }
      setMessage('采集仍在后台运行，可稍后查看');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : '刷新失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    <aside className="flex flex-col gap-3 rounded-2xl border border-[#d9c4ac] bg-[#fff7eb] p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="flex items-center gap-2 font-bold text-[#4b3728]"><ShieldCheck className="h-4 w-4" />管理员采集</div><p className="mt-1 text-xs text-[#806a57]">每小时自动运行，也可以立即手动刷新六个榜单。</p>{message && <p className="mt-2 text-sm font-semibold text-[#9b4f22]" aria-live="polite">{message}</p>}</div>
      <button type="button" disabled={running} onClick={() => void refresh()} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#392b20] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />{running ? '刷新中' : '手动刷新'}</button>
    </aside>
  );
}
