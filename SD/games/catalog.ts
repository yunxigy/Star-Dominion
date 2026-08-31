export type GameId = 'tic-tac-toe' | 'connect-four' | 'gomoku' | 'othello' | 'chess' | 'xiangqi' | 'checkers';

export interface GameCatalogItem {
  id: GameId;
  name: string;
  description: string;
  icon: string;
  gradient: string;
  badge: string;
}

export const GAME_CATALOG: GameCatalogItem[] = [
  {
    id: 'tic-tac-toe',
    name: '井字棋',
    description: '经典 3×3 棋盘，支持人机对战和双人同屏。',
    icon: 'Grid3x3',
    gradient: 'from-emerald-600 to-teal-600',
    badge: '已上线',
  },
  {
    id: 'connect-four',
    name: '四子棋',
    description: '7×6 棋盘，先连成四子即可获胜，支持人机和双人同屏。',
    icon: 'LayoutGrid',
    gradient: 'from-amber-500 to-orange-600',
    badge: '已上线',
  },
  {
    id: 'gomoku',
    name: '五子棋',
    description: '15×15 棋盘，横竖斜连成五子即可获胜，支持人机和双人同屏。',
    icon: 'Grid2x2',
    gradient: 'from-slate-600 to-zinc-800',
    badge: '已上线',
  },
  {
    id: 'othello',
    name: '黑白棋',
    description: '翻转并占领更多棋子，支持标准 8×8 棋盘和本地 AI 对战。',
    icon: 'Dices',
    gradient: 'from-sky-600 to-indigo-700',
    badge: '已上线',
  },
  {
    id: 'chess',
    name: '国际象棋',
    description: '完整 8×8 国际象棋规则，支持王车易位、升变和人机对战。',
    icon: 'Crown',
    gradient: 'from-violet-600 to-fuchsia-700',
    badge: '已上线',
  },
  {
    id: 'xiangqi',
    name: '中国象棋',
    description: '楚河汉界、炮打隔子，支持将军判定和本地 AI 对战。',
    icon: 'Landmark',
    gradient: 'from-rose-600 to-red-700',
    badge: '已上线',
  },
  {
    id: 'checkers',
    name: '跳棋',
    description: '强制吃子、多步连跳和升王规则，支持人机与双人同屏。',
    icon: 'Grid2x2',
    gradient: 'from-cyan-600 to-blue-700',
    badge: '已上线',
  },
];

export function getGameById(gameId: string | undefined): GameCatalogItem | undefined {
  return GAME_CATALOG.find(game => game.id === gameId);
}
