import { ArrowRight, Gamepad2, Grid3X3, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageSeo } from '../components/PageSeo';
import { getIcon } from '../lib/iconMap';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';
import { GAME_CATALOG } from '../games/catalog';

const GAMES_METADATA = {
  title: `趣味游戏 - 单机与双人在线小游戏 | ${SITE.name}`,
  description: '逐梦工具箱趣味游戏中心，提供无需安装、无需联网的单机和双人同屏小游戏。',
  canonical: absoluteSiteUrl('/games'),
  type: 'website' as const,
  jsonLd: [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '趣味游戏',
    description: '无需联网即可游玩的单机与双人同屏小游戏。',
    url: absoluteSiteUrl('/games'),
    numberOfItems: GAME_CATALOG.length,
  }],
};

export function GamesPage() {
  return (
    <>
      <PageSeo metadata={GAMES_METADATA} />
      <div className="mx-auto max-w-6xl space-y-8">
        <header className="glass-card rounded-[2rem] p-6 sm:p-8 lg:p-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--accent-strong)] hover:underline">
              <ArrowRight className="h-4 w-4 rotate-180" aria-hidden="true" />
              返回首页
            </Link>
            <span className="inline-flex items-center gap-2 rounded-full bg-[var(--accent-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-strong)]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              本地运行 · 不上传棋局
            </span>
          </div>
          <div className="mt-8 flex items-start gap-4">
            <span className="rounded-2xl bg-gradient-to-br from-emerald-600 to-teal-600 p-3 text-white shadow-lg shadow-emerald-700/20">
              <Gamepad2 className="h-7 w-7" aria-hidden="true" />
            </span>
            <div>
              <p className="mb-2 text-sm font-bold uppercase tracking-[0.18em] text-[var(--accent)]">Playground</p>
              <h1 className="text-3xl font-black text-[var(--text)] sm:text-5xl">趣味游戏</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--text-muted)] sm:text-lg">
                休息一下，来一局轻量小游戏。支持单机、人机和双人同屏，打开浏览器就能玩。
              </p>
            </div>
          </div>
        </header>

        <section aria-labelledby="games-catalog-title">
          <div className="mb-4 flex items-end justify-between gap-3">
            <div>
              <h2 id="games-catalog-title" className="text-2xl font-black text-[var(--text)]">选择游戏</h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">选择规则简单、随时开局的本地小游戏</p>
            </div>
            <span className="text-sm font-semibold text-[var(--text-soft)]">{GAME_CATALOG.length} 款已上线</span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {GAME_CATALOG.map(game => {
              const Icon = getIcon(game.icon);
              return (
                <Link
                  key={game.id}
                  to={`/games/${game.id}`}
                  className="group glass-card flex min-h-[220px] flex-col rounded-3xl p-5 transition hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className={`rounded-2xl bg-gradient-to-br ${game.gradient} p-3 text-white shadow-lg`}>
                      <Icon className="h-6 w-6" aria-hidden="true" />
                    </span>
                    <span className="rounded-full bg-[var(--olive-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--olive)]">{game.badge}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-black text-[var(--text)] group-hover:text-[var(--accent-strong)]">{game.name}</h3>
                  <p className="mt-2 flex-1 text-sm leading-6 text-[var(--text-muted)]">{game.description}</p>
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-[var(--accent-strong)]">
                    开始游戏
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                  </span>
                </Link>
              );
            })}
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-[var(--accent-strong)]" aria-hidden="true" />
              <h2 className="font-bold text-[var(--text)]">双人同屏</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">一台设备轮流落子，不需要注册，也不需要连接服务器。</p>
          </div>
          <div className="glass-card rounded-2xl p-5">
            <div className="flex items-center gap-3">
              <Grid3X3 className="h-5 w-5 text-[var(--accent-strong)]" aria-hidden="true" />
              <h2 className="font-bold text-[var(--text)]">更多棋类陆续上线</h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">五子棋、黑白棋、国际象棋、中国象棋和跳棋均已上线，更多玩法会沿用同一套本地游戏框架。</p>
          </div>
        </div>
      </div>
    </>
  );
}

export default GamesPage;
