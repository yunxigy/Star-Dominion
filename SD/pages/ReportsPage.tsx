import { ArrowRight, Github, Newspaper, Radar } from 'lucide-react';
import { Link } from 'react-router-dom';

export function ReportsPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <section className="rounded-[2rem] border border-[#d9c4ac] bg-[#fff9ef] p-7 shadow-sm sm:p-10">
        <div className="inline-flex items-center gap-2 rounded-full bg-[#ead7c0] px-3 py-1.5 text-sm font-bold text-[#74451f]"><Newspaper className="h-4 w-4" />独立研报中心</div>
        <h1 className="mt-5 text-4xl font-black text-[#2f241b] sm:text-5xl">把变化整理成可读的情报</h1>
        <p className="mt-4 max-w-2xl text-base leading-8 text-[#705d4b]">研报模块独立采集和保存公开信息。首期聚焦 GitHub 热门项目，每小时扫描一次，每周形成新榜单。</p>
      </section>
      <Link to="/reports/github" className="group block rounded-[2rem] border border-[#ccb397] bg-[#2c221a] p-7 text-white shadow-xl transition hover:-translate-y-1 sm:p-9">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <div><div className="flex items-center gap-3 text-[#f2cda9]"><Github className="h-6 w-6" /><Radar className="h-5 w-5" /></div><h2 className="mt-5 text-3xl font-black">GitHub 开源项目周榜</h2><p className="mt-3 max-w-xl leading-7 text-[#d6c6b8]">综合、Python、JavaScript、TypeScript、Go、Rust 六榜，标出新上榜、升降、连续热门和增长最快。</p></div>
          <span className="inline-flex items-center gap-2 font-bold text-[#f6d2ae]">查看最新一期<ArrowRight className="h-5 w-5 transition group-hover:translate-x-1" /></span>
        </div>
      </Link>
    </div>
  );
}
