import { drawUnique, RandomSource } from '../utils/random';

export interface NativeTarotCard {
  id: string;
  name: string;
  keywords: string[];
  upright: string;
  reversed: string;
}

const MAJOR_NAMES = [
  '愚者', '魔术师', '女祭司', '皇后', '皇帝', '教皇', '恋人', '战车', '力量', '隐者',
  '命运之轮', '正义', '倒吊人', '死神', '节制', '恶魔', '高塔', '星星', '月亮', '太阳', '审判', '世界',
];

const SUITS = [
  ['权杖', '行动'],
  ['圣杯', '情感'],
  ['宝剑', '思考'],
  ['星币', '现实'],
] as const;

const RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍者', '骑士', '王后', '国王'];

const MAJOR_CARDS: NativeTarotCard[] = MAJOR_NAMES.map((name, index) => ({
  id: `major-${index}`,
  name,
  keywords: ['转折', '选择', '成长'],
  upright: '保持觉察，顺势而行，你正在获得新的理解。',
  reversed: '先放慢脚步，确认自己的真实意愿再做决定。',
}));

const MINOR_CARDS: NativeTarotCard[] = SUITS.flatMap(([suit, theme]) => RANKS.map((rank, index) => ({
  id: `${suit}-${index + 1}`,
  name: `${suit}${rank}`,
  keywords: [theme, '节奏', '经验'],
  upright: `围绕${theme}的一步推进，适合把想法落到具体行动。`,
  reversed: `围绕${theme}的节奏需要调整，避免被短期情绪牵着走。`,
})));

export const TAROT_CARDS: NativeTarotCard[] = [...MAJOR_CARDS, ...MINOR_CARDS];

export function drawTarotCards(count: number, random: RandomSource = Math.random): NativeTarotCard[] {
  return drawUnique(TAROT_CARDS, Math.min(5, Math.max(1, Math.floor(count))), random);
}

export function tarotReading(card: NativeTarotCard, reversed: boolean): string {
  return reversed ? card.reversed : card.upright;
}
