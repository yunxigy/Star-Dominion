import { describe, expect, it } from 'vitest';

import { buildRadarPoints, radarPoint } from './radarGeometry';

describe('radar geometry', () => {
  it('places the first full-score point at the top of the chart', () => {
    expect(radarPoint(0, 4, 100, 100, 80)).toEqual({ x: 100, y: 20 });
  });

  it('maps zero to the center and clamps scores to 0–100', () => {
    expect(radarPoint(2, 5, 0, 100, 80)).toEqual({ x: 100, y: 100 });
    expect(radarPoint(0, 4, 140, 100, 80)).toEqual({ x: 100, y: 20 });
  });

  it('builds one finite point per dimension and treats null as zero', () => {
    const points = buildRadarPoints([100, 50, null, 25], 100, 80);
    expect(points).toHaveLength(4);
    expect(points.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(points[2]).toEqual({ x: 100, y: 100 });
  });
});
