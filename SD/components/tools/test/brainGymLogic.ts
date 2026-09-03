export type BrainGymMode = 'reaction' | 'number-memory' | 'sequence-memory';

export interface BrainGymModeDefinition {
  id: BrainGymMode;
  label: string;
  description: string;
  hint: string;
}

export interface NumberMemoryChallenge {
  value: string;
  digits: number;
  level: number;
}

export const BRAIN_GYM_MODES: BrainGymModeDefinition[] = [
  {
    id: 'reaction',
    label: '反应速度',
    description: '等屏幕变绿后立即点击，测一测你的瞬间反应。',
    hint: '不要提前点击，绿色出现后再出手。',
  },
  {
    id: 'number-memory',
    label: '数字记忆',
    description: '记住逐渐变长的数字串，看看工作记忆能走到第几关。',
    hint: '数字只会出现一小会儿，准备好再开始。',
  },
  {
    id: 'sequence-memory',
    label: '方格序列',
    description: '按顺序复现亮起的方格，挑战你的空间记忆。',
    hint: '记住亮起顺序，点错一格就会结束本轮。',
  },
];

export const BRAIN_GYM_BEST_KEY = 'sd-brain-gym-best';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function normalizedRandom(random: () => number): number {
  return clamp(Number.isFinite(random()) ? random() : 0, 0, 0.999999999);
}

export function createNumberMemory(level: number, random: () => number = Math.random): NumberMemoryChallenge {
  const safeLevel = clamp(Math.floor(level), 1, 9);
  const digits = safeLevel + 2;
  let value = '';
  for (let index = 0; index < digits; index += 1) {
    value += Math.floor(normalizedRandom(random) * 10).toString();
  }
  return { value, digits, level: safeLevel };
}

export function createSequenceChallenge(
  length: number,
  gridSize = 3,
  random: () => number = Math.random,
): number[] {
  const safeGridSize = clamp(Math.floor(gridSize), 2, 6);
  const cells = Array.from({ length: safeGridSize * safeGridSize }, (_, index) => index);
  const safeLength = clamp(Math.floor(length), 1, cells.length);

  for (let index = 0; index < safeLength; index += 1) {
    const swapIndex = index + Math.floor(normalizedRandom(random) * (cells.length - index));
    [cells[index], cells[swapIndex]] = [cells[swapIndex], cells[index]];
  }

  return cells.slice(0, safeLength);
}

export function getReactionDelay(random: () => number = Math.random): number {
  return 1400 + Math.floor(normalizedRandom(random) * 2600);
}

export function formatBrainGymScore(mode: BrainGymMode, score: number): string {
  if (mode === 'reaction') return `${Math.round(score)} ms`;
  if (mode === 'number-memory') return `${Math.round(score)} 位数字`;
  return `${Math.round(score)} 格序列`;
}

export function getBrainGymGrade(mode: BrainGymMode, score: number): string {
  if (mode === 'reaction') {
    if (score < 220) return '闪电反应';
    if (score < 320) return '反应很快';
    if (score < 450) return '稳稳接住';
    return '再热身一次';
  }
  if (mode === 'number-memory') {
    if (score >= 8) return '记忆超能手';
    if (score >= 6) return '记忆小能手';
    if (score >= 4) return '状态不错';
    return '继续热身';
  }
  if (score >= 12) return '空间记忆王';
  if (score >= 8) return '序列达人';
  if (score >= 5) return '观察力在线';
  return '再来一局';
}

export function isBetterBrainGymScore(
  mode: BrainGymMode,
  score: number,
  best: number | null | undefined,
): boolean {
  if (best === null || best === undefined) return true;
  return mode === 'reaction' ? score < best : score > best;
}

function readBestScores(): Partial<Record<BrainGymMode, number>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(BRAIN_GYM_BEST_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const record = parsed as Record<string, unknown>;
    return {
      reaction: typeof record.reaction === 'number' && Number.isFinite(record.reaction) ? record.reaction : undefined,
      'number-memory': typeof record['number-memory'] === 'number' && Number.isFinite(record['number-memory']) ? record['number-memory'] : undefined,
      'sequence-memory': typeof record['sequence-memory'] === 'number' && Number.isFinite(record['sequence-memory']) ? record['sequence-memory'] : undefined,
    };
  } catch {
    return {};
  }
}

export function getBrainGymBest(mode: BrainGymMode): number | null {
  return readBestScores()[mode] ?? null;
}

export function saveBrainGymBest(mode: BrainGymMode, score: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(score) || score <= 0) return;
  const scores = readBestScores();
  if (!isBetterBrainGymScore(mode, score, scores[mode])) return;
  try {
    window.localStorage.setItem(BRAIN_GYM_BEST_KEY, JSON.stringify({ ...scores, [mode]: score }));
  } catch {
    // Private browsing or a disabled storage area should not interrupt a game.
  }
}
