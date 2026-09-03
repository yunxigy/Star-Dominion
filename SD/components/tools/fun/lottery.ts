export type RandomSource = () => number;

export type LotteryMode = 'rolling' | 'wheel' | 'card';

export interface LotteryHistoryEntry {
  id: number;
  mode: LotteryMode;
  winners: string[];
  time: string;
}

export interface LotteryPreset {
  id: string;
  label: string;
  description: string;
  entries: string[];
  count: number;
}

export const LOTTERY_PRESETS: readonly LotteryPreset[] = [
  {
    id: 'classroom',
    label: '课堂点名',
    description: '适合点名、回答问题和随机分组',
    entries: ['小组 A', '小组 B', '小组 C', '小组 D', '小组 E', '小组 F'],
    count: 1,
  },
  {
    id: 'party',
    label: '聚会游戏',
    description: '把谁来表演、谁来选歌交给随机',
    entries: ['小红', '小明', '阿杰', '小雨', '安安', '阿宁'],
    count: 1,
  },
  {
    id: 'tasks',
    label: '任务分配',
    description: '一次抽出几位负责接下来的任务',
    entries: ['主持人', '记录员', '计时员', '摄影师', '分享人', '收尾人'],
    count: 2,
  },
];

const LOTTERY_HISTORY_KEY = 'sd-lottery-history';

export function parseLotteryEntries(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function buildLotteryPool(entries: readonly string[], deduplicate: boolean): string[] {
  return deduplicate ? [...new Set(entries)] : [...entries];
}

export function getAvailableLotteryEntries(
  pool: readonly string[],
  eliminated: readonly string[],
): string[] {
  const eliminatedSet = new Set(eliminated);
  return pool.filter((entry) => !eliminatedSet.has(entry));
}

export function drawWinners<T>(items: readonly T[], requestedCount: number, random: RandomSource = Math.random): T[] {
  const available = [...items];
  if (available.length === 0) return [];

  const count = Math.min(Math.max(Math.floor(requestedCount) || 1, 1), available.length);
  const winners: T[] = [];

  for (let index = 0; index < count; index += 1) {
    const randomValue = random();
    const normalized = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999) : 0;
    const selectedIndex = Math.floor(normalized * available.length);
    winners.push(available.splice(selectedIndex, 1)[0]);
  }

  return winners;
}

export function getWheelRotation(
  selectedIndex: number,
  itemCount: number,
  currentRotation = 0,
  extraTurns = 5,
): number {
  if (itemCount <= 0) return currentRotation;

  const segmentAngle = 360 / itemCount;
  const safeIndex = ((Math.floor(selectedIndex) % itemCount) + itemCount) % itemCount;
  const targetAngle = (360 - (safeIndex + 0.5) * segmentAngle + 360) % 360;
  const safeCurrentRotation = Number.isFinite(currentRotation) ? currentRotation : 0;
  const turns = Math.max(1, Math.floor(extraTurns));
  const baseRotation = safeCurrentRotation + turns * 360;
  const currentAngle = ((baseRotation % 360) + 360) % 360;
  const delta = (targetAngle - currentAngle + 360) % 360;

  return baseRotation + delta;
}

export function getLotteryShareText(
  winners: readonly string[],
  mode: LotteryMode,
  time: string,
): string {
  const modeLabel: Record<LotteryMode, string> = {
    rolling: '滚动开奖',
    wheel: '幸运转盘',
    card: '翻牌抽奖',
  };
  return [
    `${modeLabel[mode]}抽奖结果（${time}）`,
    ...winners.map((winner, index) => `第 ${index + 1} 名：${winner}`),
  ].join('\n');
}

export function loadLotteryHistory(): LotteryHistoryEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const stored = JSON.parse(window.localStorage.getItem(LOTTERY_HISTORY_KEY) || '[]');
    if (!Array.isArray(stored)) return [];
    return stored
      .filter((entry): entry is LotteryHistoryEntry => (
        entry && typeof entry === 'object'
        && typeof entry.id === 'number'
        && ['rolling', 'wheel', 'card'].includes(entry.mode)
        && Array.isArray(entry.winners)
        && entry.winners.every((winner: unknown) => typeof winner === 'string')
        && typeof entry.time === 'string'
      ))
      .slice(0, 8);
  } catch {
    return [];
  }
}

export function saveLotteryHistory(history: readonly LotteryHistoryEntry[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(LOTTERY_HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  } catch {
    // 浏览器禁用存储时，抽奖本身仍然可以继续使用。
  }
}
