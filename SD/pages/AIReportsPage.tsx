import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getAICatalog, refreshAICatalog, type AICatalogResponse } from '../lib/researchReports';

const categories = [['all','全部'],['agent_skill','Agent / Skill'],['mcp','MCP'],['llm_rag','LLM / RAG'],['computer_use','Computer Use'],['ai_app','AI 应用'],['ai_infra','AI Infra']];

function Skeleton() {
  return <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({length:6}).map((_,i)=><div key={i} className="rounded-2xl border border-[#decbb5] bg-white p-5"><div className="flex justify-between"><div className="h-4 w-16 animate-pulse rounded bg-[#f0e4d4]" /><div className="h-4 w-12 animate-pulse rounded bg-[#f0e4d4]" /></div><div className="mt-3 h-6 w-40 animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-3 h-4 w-full animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-4 flex gap-2"><div className="h-5 w-14 animate-pulse rounded-full bg-[#f6eadb]" /><div className="h-5 w-14 animate-pulse rounded-full bg-[#f6eadb]" /></div></div>)}</div>;
}

export function AIReportsPage() {
  const { user } = useAuth();
  const [category, setCategory] = useState('all');
  const [data, setData] = useState<AICatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError('');
    void getAICatalog(category).then(d => { setData(d); setLoading(false); }).catch(reason => {
      setError(reason instanceof Error ? reason.message : 'AI 榜单读取失败'); setLoading(false);
    });
  }, [category]);

  useEffect(load, [load]);

  const handleRefresh = async () => {
    setRefreshing(true); setError('');
    try { await refreshAICatalog(); load(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '刷新失败');
    } finally { setRefreshing(false); }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 pb-12">
      <header className="rounded-3xl border border-[#d9c4ac] bg-[#fff9ef] p-7">
        <p className="text-sm font-bold text-[#9b4f22]">GitHub AI 生态</p>
        <h1 className="mt-2 text-4xl font-black text-[#2f241b]">AI 项目正在怎么增长</h1>
        <p className="mt-3 text-[#705d4b]">公开 Trending 页面筛选 Agent、Skill、MCP、RAG 和 AI Infra 项目，不依赖 GitHub Token。</p>
        {data?.updatedAt && <p className="mt-2 text-xs text-[#9b8a78]">上次更新：{new Date(data.updatedAt).toLocaleString('zh-CN')}</p>}
      </header>

      <nav className="flex flex-wrap gap-2">
        {categories.map(([value, label]) => (
          <button key={value} onClick={() => setCategory(value)}
            className={`rounded-full px-4 py-2 text-sm font-bold ${category === value ? 'bg-[#392b20] text-white' : 'border border-[#decbb5] bg-white text-[#5d4938]'}`}>
            {label}
          </button>
        ))}
      </nav>

      {user?.role === 'admin' && (
        <aside className="flex flex-col gap-3 rounded-2xl border border-[#d9c4ac] bg-[#fff7eb] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 font-bold text-[#4b3728]"><ShieldCheck className="h-4 w-4" />管理员操作</div>
            <p className="mt-1 text-xs text-[#806a57]">手动刷新 AI 生态分类（每小时自动运行）。</p>
          </div>
          <button type="button" disabled={refreshing} onClick={() => void handleRefresh()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#392b20] px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? '刷新中' : '刷新分类'}
          </button>
        </aside>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 p-4 text-rose-800">
          <span>{error}</span>
          <button onClick={load} className="ml-4 rounded-lg bg-rose-100 px-3 py-1 text-sm font-bold hover:bg-rose-200">重试</button>
        </div>
      )}

      {loading ? <Skeleton /> : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data?.items.map(item => (
            <a key={item.id} href={item.htmlUrl} target="_blank" rel="noreferrer"
              className="rounded-2xl border border-[#decbb5] bg-white p-5 transition hover:-translate-y-1 hover:shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase text-[#9b4f22]">{item.category}</span>
                <span className="text-sm font-bold text-[#705d4b]">Score {item.score}</span>
              </div>
              <h2 className="mt-3 text-xl font-black text-[#2f241b]">{item.fullName}</h2>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-[#705d4b]">{item.description || '暂无描述'}</p>
              <div className="mt-3 flex items-center gap-3 text-xs text-[#806a57]">
                <span>⭐ {item.starsTotal.toLocaleString()}</span>
                <span className="text-emerald-700">+{item.starsSinceWeekly.toLocaleString()}/周</span>
                {item.primaryLanguage && <span className="rounded bg-[#f0e4d4] px-1.5 py-0.5">{item.primaryLanguage}</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.reasons.slice(0, 4).map(reason => (
                  <span key={reason} className="rounded-full bg-[#f6eadb] px-2 py-1 text-xs text-[#74451f]">{reason}</span>
                ))}
              </div>
            </a>
          ))}
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[#cdb79f] p-10 text-center text-[#705d4b]">等待公开源更新</p>
      )}
    </div>
  );
}