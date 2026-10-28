export type RandomSource = () => number;

export const DICE_COUNT_LIMIT = 12;
export const DICE_SIDES_LIMIT = 20;

function clampSetting(value: number, fallback: number, maximum: number, minimum: number): number {
  const numericValue = Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(maximum, Math.max(minimum, numericValue));
}

export function rollDice(count: number, sides: number, random: RandomSource = Math.random): number[] {
  const safeCount = clampSetting(count, 1, DICE_COUNT_LIMIT, 1);
  const safeSides = clampSetting(sides, 6, DICE_SIDES_LIMIT, 2);

  return Array.from({ length: safeCount }, () => {
    const randomValue = random();
    const normalized = Number.isFinite(randomValue) ? Math.min(Math.max(randomValue, 0), 0.999999999) : 0;
    return Math.floor(normalized * safeSides) + 1;
  });
}

export function getDiceTotal(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
