export type RandomSource = () => number;

export function parseLotteryEntries(value: string): string[] {
  return value
    .split(/[\n,，]+/)
    .map(entry => entry.trim())
    .filter(Boolean);
}

export function buildLotteryPool(entries: readonly string[], deduplicate: boolean): string[] {
  return deduplicate ? [...new Set(entries)] : [...entries];
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
