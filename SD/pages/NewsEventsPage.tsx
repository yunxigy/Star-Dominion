import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { collectNews, getNewsItems, getSocialEvents, type NewsPage } from '../lib/researchReports';
import { cleanNewsText, displayNewsSource, displayNewsSummary, displayNewsTitle } from '../lib/newsPresentation';

function Skeleton() {
  return <div className="space-y-3">{Array.from({length:5}).map((_,i)=><div key={i} className="rounded-2xl border border-[#decbb5] bg-white p-5"><div className="flex gap-2"><div className="h-3 w-20 animate-pulse rounded bg-[#f0e4d4]" /><div className="h-3 w-3 animate-pulse rounded bg-[#f0e4d4]" /><div className="h-3 w-28 animate-pulse rounded bg-[#f0e4d4]" /></div><div className="mt-3 h-5 w-3/4 animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-2 h-4 w-full animate-pulse rounded bg-[#f0e4d4]" /><div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-[#f0e4d4]" /></div>)}</div>;
}

const importanceLabel = (score: number) => {
  if (score >= 80) return { text: '重要', cls: 'bg-rose-100 text-rose-800' };
  if (score >= 50) return { text: '关注', cls: 'bg-amber-100 text-amber-800' };
  return { text: '常规', cls: 'bg-stone-100 text-stone-600' };
};

export function NewsEventsPage() {
  const { user } = useAuth();
  const [data, setData] = useState<NewsPage | null>(null);
  const [social, setSocial] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [collecting, setCollecting] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setError('');
    const fetcher = social ? getSocialEvents() : getNewsItems();
    void fetcher.then(d => { setData(d); setLoading(false); }).catch(reason => {
      setError(reason instanceof Error ? reason.message : '新闻读取失败'); setLoading(false);
    });
  }, [social]);

  useEffect(load, [load]);

  const handleCollect = async () => {
    setCollecting(true); setError('');
    try { await collectNews(); load(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : '采集失败');
    } finally { setCollecting(false); }
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 pb-12">
      <header className="rounded-3xl border border-[#d9c4ac] bg-[#fff9ef] p-7">
        <p className="text-sm font-bold text-[#9b4f22]">过去 24 小时</p>
        <h1 className="mt-2 text-4xl font-black text-[#2f241b]">AI 圈大事</h1>
        <p className="mt-3 text-[#705d4b]">公开 RSS、新闻聚合和可索引的 X/Twitter 内容，保留来源和原文链接。</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setSocial(false)}
          className={`rounded-full px-4 py-2 text-sm font-bold ${!social ? 'bg-[#392b20] text-white' : 'border border-[#decbb5] bg-white text-[#5d4938]'}`}>
          AI 新闻
        </button>
        <button onClick={() => setSocial(true)}
          className={`rounded-full px-4 py-2 text-sm font-bold ${social ? 'bg-[#392b20] text-white' : 'border border-[#decbb5] bg-white text-[#5d4938]'}`}>
          社交大事
        </button>
        {user?.role === 'admin' && (
          <button type="button" disabled={collecting} onClick={() => void handleCollect()}
            className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#392b20] px-4 py-2 text-sm font-bold text-white disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${collecting ? 'animate-spin' : ''}`} />
            {collecting ? '采集中' : '采集新闻'}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-rose-50 p-4 text-rose-800">
          <span>{error}</span>
          <button onClick={load} className="ml-4 rounded-lg bg-rose-100 px-3 py-1 text-sm font-bold hover:bg-rose-200">重试</button>
        </div>
      )}

      {loading ? <Skeleton /> : (
        <div className="space-y-3">
          {data?.items.map(item => {
            const imp = importanceLabel(item.importanceScore);
            const title = displayNewsTitle(item.title, item.topics);
            const summary = displayNewsSummary(item.summary, item.title, item.topics);
            return (
              <article key={item.id} className="rounded-2xl border border-[#decbb5] bg-white p-5">
                <div className="flex flex-wrap items-center gap-2 text-xs text-[#806a57]">
                  <span className="font-medium">{displayNewsSource(item.authorOrPublisher, item.sourceId)}</span>
                  <span>·</span>
                  <time>{new Date(item.publishedAt).toLocaleString('zh-CN')}</time>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${imp.cls}`}>{imp.text}</span>
                  {item.topics.length > 0 && item.topics.slice(0, 3).map(t => (
                    <span key={t} className="rounded-full bg-[#f6eadb] px-2 py-0.5 text-xs text-[#74451f]">{t}</span>
                  ))}
                </div>
                <h2 className="mt-2 text-xl font-black text-[#2f241b]">{title}</h2>
                <p className="mt-2 leading-7 text-[#705d4b]">{summary}</p>
                <p className="mt-2 text-sm text-[#9a826d]">原文标题：{cleanNewsText(item.title) || '未命名新闻'}</p>
                <a className="mt-3 inline-block text-sm font-bold text-[#9b4f22]" href={item.canonicalUrl} target="_blank" rel="noreferrer">查看原文 →</a>
              </article>
            );
          })}
        </div>
      )}

      {data && data.items.length === 0 && (
        <p className="rounded-2xl border border-dashed p-10 text-center text-[#705d4b]">暂无过去 24 小时内容</p>
      )}
    </div>
  );
}
