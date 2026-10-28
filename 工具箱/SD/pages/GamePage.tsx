import { ArrowLeft, Gamepad2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { CheckersGame } from '../components/games/CheckersGame';
import { ChessGame } from '../components/games/ChessGame';
import { ConnectFourGame } from '../components/games/ConnectFourGame';
import { GomokuGame } from '../components/games/GomokuGame';
import { OthelloGame } from '../components/games/OthelloGame';
import { TicTacToeGame } from '../components/games/TicTacToeGame';
import { XiangqiGame } from '../components/games/XiangqiGame';
import { PageSeo } from '../components/PageSeo';
import { getGameById } from '../games/catalog';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';

export function GamePage() {
  const { gameId } = useParams<{ gameId: string }>();
  const game = getGameById(gameId);

  if (!game) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-xl items-center justify-center">
        <div className="glass-card w-full rounded-3xl p-8 text-center">
          <Gamepad2 className="mx-auto h-10 w-10 text-[var(--text-soft)]" aria-hidden="true" />
          <h1 className="mt-4 text-2xl font-black text-[var(--text)]">游戏未找到</h1>
          <p className="mt-2 text-sm text-[var(--text-muted)]">这个游戏可能还没有上线。</p>
          <Link to="/games" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--accent)] px-4 py-2.5 font-semibold text-white hover:bg-[var(--accent-strong)]">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回游戏大厅
          </Link>
        </div>
      </div>
    );
  }

  const metadata = {
    title: `${game.name} - 免费在线小游戏 | ${SITE.name}`,
    description: `${game.description} 无需安装，支持浏览器本地游玩。`,
    canonical: absoluteSiteUrl(`/games/${game.id}`),
    type: 'website' as const,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.name,
      description: `${game.description} 无需安装，支持浏览器本地游玩。`,
      url: absoluteSiteUrl(`/games/${game.id}`),
      gamePlatform: 'Web Browser',
      playMode: 'SinglePlayer, MultiPlayer',
    }],
  };

  return (
    <>
      <PageSeo metadata={metadata} />
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`rounded-xl bg-gradient-to-br ${game.gradient} p-2.5 text-white shadow-lg`}>
              <Gamepad2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-soft)]">
                <Link to="/games" className="hover:text-[var(--accent-strong)]">趣味游戏</Link>
                <span aria-hidden="true">/</span>
                <span aria-current="page">{game.name}</span>
              </div>
              <h1 className="mt-1 text-3xl font-black text-[var(--text)]">{game.name}</h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">{game.description}</p>
            </div>
          </div>
          <Link to="/games" className="inline-flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-semibold text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:text-[var(--text)]">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            返回游戏大厅
          </Link>
        </header>

        {game.id === 'tic-tac-toe' && <TicTacToeGame />}
        {game.id === 'connect-four' && <ConnectFourGame />}
        {game.id === 'gomoku' && <GomokuGame />}
        {game.id === 'othello' && <OthelloGame />}
        {game.id === 'chess' && <ChessGame />}
        {game.id === 'xiangqi' && <XiangqiGame />}
        {game.id === 'checkers' && <CheckersGame />}
      </div>
    </>
  );
}

export default GamePage;
