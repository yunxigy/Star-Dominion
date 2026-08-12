import { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { generateBriefing, getLatestBriefing, type BriefingPublic, type BriefingEvent } from '../lib/researchReports';

function Skeleton() {
  return <div className="rounded-3xl border border-[#decbb5] bg-white p-7"><div className="h-4 w-40 animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-4 h-8 w-3/4 animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-6 space-y-3">{Array.from({length:8}).map((_,i)=><div key={i} className="h-4 animate-pulse rounded bg-[#f0e4d4]" style={{width:`${60+Math.random()*40}%`}} />)}</div></div>;
}

const modelLabel = (provider: string | null, name: string | null) => {
  if (!name) return '规则降级';
  if (provider === 'siliconflow') return `硅基流动 · ${name}`;
  if (provider === 'deepseek') return `DeepSeek · ${name}`;
  return name;
};

export function AIBriefingPage() {
  const { user } = useAuth();
  const [data, setData] = useState<BriefingPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError('');
    void getLatestBriefing().then(d => { setData(d); setLoading(false); }).catch(reason => {
      setError(reason instanceof Error ? reason.message : '早报尚未生成'); setLoading(false);
    });
  }, []);

  useEffect(load, []);

  const regenerate = async () => {
    setRunning(true); setError('');
    try { await generateBriefing(); load(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成失败');
    } finally { setRunning(false); }
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 pb-12">
      <header className="rounded-3xl border border-[#d9c4ac] bg-[#fff9ef] p-7">
        <p className="text-sm font-bold text-[#9b4f22]">AI 早报</p>
        <h1 className="mt-2 text-4xl font-black text-[#2f241b]">过去 24 小时发生了什么</h1>
        <p className="mt-3 text-[#705d4b]">由公开来源候选资料和站点 AI 配置生成，所有结论都保留来源编号。</p>
      </header>

      {user?.role === 'admin' && (
        <div className="flex items-center gap-3">
          <button disabled={running} onClick={() => void regenerate()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#392b20] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${running ? 'animate-spin' : ''}`} />
            {running ? '生成中…' : '重新生成早报'}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-amber-50 p-4 text-amber-900">
          <span>{error}</span>
          <button onClick={load} className="ml-4 rounded-lg bg-amber-100 px-3 py-1 text-sm font-bold hover:bg-amber-200">重试</button>
        </div>
      )}

      {loading ? <Skeleton /> : data && (
        <article className="rounded-3xl border border-[#decbb5] bg-white p-7">
          <div className="flex flex-wrap items-center gap-3 text-sm text-[#806a57]">
            <span className="font-bold text-[#2f241b]">{data.reportDate}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${data.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
              {data.status === 'completed' ? '已完成' : data.status}
            </span>
            <span className="rounded-full bg-[#f0e4d4] px-2 py-0.5 text-xs">{modelLabel(data.modelProvider, data.modelName)}</span>
          </div>

          {data.title && <h2 className="mt-4 text-3xl font-black text-[#2f241b]">{data.title}</h2>}

          {data.summaryMarkdown && (
            <div className="mt-5 whitespace-pre-wrap leading-8 text-[#4e3d2e]">{data.summaryMarkdown}</div>
          )}

          {data.events.length > 0 && (
            <section className="mt-6">
              <h3 className="text-lg font-bold text-[#2f241b]">关键事件</h3>
              <ul className="mt-3 space-y-3">
                {data.events.map((ev: BriefingEvent, i: number) => (
                  <li key={i} className="rounded-xl border border-[#e8d9c4] bg-[#fffbf5] p-4">
                    {ev.title && <p className="font-bold text-[#2f241b]">{ev.title}</p>}
                    {ev.summary && <p className="mt-1 text-sm leading-6 text-[#705d4b]">{ev.summary}</p>}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-[#9b8a78]">
                      {ev.sourceId && <span>来源 #{ev.sourceId}</span>}
                      {ev.url && <a href={ev.url} target="_blank" rel="noreferrer" className="font-bold text-[#9b4f22]">查看原文 →</a>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.risks.length > 0 && (
            <section className="mt-6">
              <h3 className="text-lg font-bold text-[#2f241b]">风险提示</h3>
              <ul className="mt-3 space-y-2">
                {data.risks.map((risk: string, i: number) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-[#705d4b]">
                    <span className="mt-0.5 text-amber-500">⚠</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {data.errorMessage && (
            <p className="mt-6 rounded-xl bg-amber-50 p-4 text-amber-900">{data.errorMessage}</p>
          )}
        </article>
      )}
    </div>
  );
}