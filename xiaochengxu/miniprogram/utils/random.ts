import { ToolResult } from './result';

export type RandomSource = () => number;

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NUMBERS = '0123456789';
const SYMBOLS = '!@#$%^&*';

function normalizedRandom(random: RandomSource): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
}

export function randomInt(min: number, max: number, random: RandomSource = Math.random): number {
  const lower = Math.ceil(Math.min(min, max));
  const upper = Math.floor(Math.max(min, max));
  if (lower >= upper) return lower;
  return Math.floor(normalizedRandom(random) * (upper - lower + 1)) + lower;
}

export function rollDice(count: number, sides: number, random: RandomSource = Math.random): number[] {
  const safeCount = Math.min(12, Math.max(1, Math.floor(Number.isFinite(count) ? count : 1)));
  const safeSides = Math.min(100, Math.max(2, Math.floor(Number.isFinite(sides) ? sides : 6)));
  return Array.from({ length: safeCount }, () => randomInt(1, safeSides, random));
}

export function drawUnique<T>(items: readonly T[], requestedCount: number, random: RandomSource = Math.random): T[] {
  const available = [...items];
  const count = Math.min(available.length, Math.max(0, Math.floor(requestedCount)));
  const winners: T[] = [];
  for (let index = 0; index < count; index += 1) {
    const selectedIndex = Math.floor(normalizedRandom(random) * available.length);
    winners.push(available.splice(selectedIndex, 1)[0]);
  }
  return winners;
}

export interface PasswordOptions {
  lowercase?: boolean;
  uppercase?: boolean;
  numbers?: boolean;
  symbols?: boolean;
}

export function generatePassword(
  length: number,
  options: PasswordOptions = {},
  random: RandomSource = Math.random,
): ToolResult<string> {
  const safeLength = Math.floor(length);
  if (!Number.isFinite(safeLength) || safeLength < 1 || safeLength > 128) {
    return { ok: false, error: '密码长度应为 1 到 128 位' };
  }

  const groups: string[] = [];
  if (options.lowercase ?? true) groups.push(LOWERCASE);
  if (options.uppercase ?? true) groups.push(UPPERCASE);
  if (options.numbers ?? true) groups.push(NUMBERS);
  if (options.symbols) groups.push(SYMBOLS);
  if (groups.length === 0) return { ok: false, error: '至少选择一种字符类型' };
  if (safeLength < groups.length) return { ok: false, error: '密码长度不足以覆盖已选字符类型' };

  const pool = groups.join('');
  const characters = groups.map((group) => group[randomInt(0, group.length - 1, random)]);
  while (characters.length < safeLength) {
    characters.push(pool[randomInt(0, pool.length - 1, random)]);
  }
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(0, index, random);
    const current = characters[index];
    characters[index] = characters[swapIndex];
    characters[swapIndex] = current;
  }
  return { ok: true, value: characters.join('') };
}

export function pickRandom<T>(items: readonly T[], random: RandomSource = Math.random): T | undefined {
  if (items.length === 0) return undefined;
  return items[Math.floor(normalizedRandom(random) * items.length)];
}

export function seededRandom(seed: number): RandomSource {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
