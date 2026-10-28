export interface RadarPoint {
  x: number;
  y: number;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function radarPoint(
  index: number,
  count: number,
  value: number,
  center: number,
  radius: number,
): RadarPoint {
  const normalized = Math.min(100, Math.max(0, value)) / 100;
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / count;
  return {
    x: round(center + Math.cos(angle) * radius * normalized),
    y: round(center + Math.sin(angle) * radius * normalized),
  };
}

export function buildRadarPoints(
  values: Array<number | null>,
  center: number,
  radius: number,
): RadarPoint[] {
  return values.map((value, index) =>
    radarPoint(index, values.length, value ?? 0, center, radius),
  );
}

export const pointsAttribute = (points: RadarPoint[]) =>
  points.map(({ x, y }) => `${x},${y}`).join(' ');
