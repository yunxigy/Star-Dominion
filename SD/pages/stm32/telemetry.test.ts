import { describe, expect, it } from 'vitest';
import { isValidMessage, normalizeAlarm, normalizeDevice, normalizeGnss, parseGnggaMessage } from './telemetry';

describe('STM32 NMEA telemetry', () => {
  it('uses backend fixed-reference ENU and converts mm to cm without subtracting map coordinates', () => {
    const gnss = normalizeGnss({ status: 'measured', valid: true, reference_id: '1:reference',
      sequence: 20, filtered_enu_mm: [6.1, 5.0, 15.0],
      history: [{ utc: '085507.00', raw_enu_mm: [15.2, 10.5, 47.6], filtered_enu_mm: [6.1, 5, 15] }] });
    expect(gnss?.history[0]).toMatchObject({ time: '08:55:07 UTC', x: .61, y: .5, z: 1.5, raw_x: 1.52 });
    expect(gnss?.filtered_enu_mm).toEqual([6.1, 5, 15]);
  });

  it('keeps polling snapshots idempotent and isolates per-device GNSS records', () => {
    const source = { gnss: { status: 'measured', valid: true, reference_id: '1:r', sequence: 1,
      filtered_enu_mm: [1, 2, 3], history: [{ utc: '085507.00', raw_enu_mm: [4, 5, 6], filtered_enu_mm: [1, 2, 3] }] } };
    expect(normalizeDevice('1', source).gnss?.history).toEqual(normalizeDevice('1', source).gnss?.history);
    expect(normalizeDevice('2', {}).gnss).toBeNull();
    expect(normalizeGnss({ history: [{ utc: '085507.00', raw_enu_mm: [1, 2, NaN], filtered_enu_mm: [1, 2, 3] }] })?.history).toEqual([]);
  });
  it('accepts the GBGGA sentence emitted by the device', () => {
    const payload = '$GBGGA,121520.00,3648.62646082,N,11759.61107990,E,7,09,1.5,33.4547,M';

    expect(isValidMessage(payload)).toBe(true);
    expect(parseGnggaMessage(payload)).toMatchObject({
      quality_code: '7',
      satellites: 9,
      altitude: 33.4547,
    });
  });

  it('preserves cloud alarm trigger details in a device snapshot', () => {
    const alarm = normalizeAlarm({
      level: 'RED',
      source: 'cloud',
      metric: 'acc_x',
      label: '加速度 X',
      value: -0.85,
      absolute_value: 0.85,
      threshold: 0.8,
      message: '加速度 X 达到 0.850 g，阈值 0.800 g',
      triggered_at_ms: 1000,
      conditions: [{
        metric: 'acc_x',
        label: '加速度 X',
        value: -0.85,
        absolute_value: 0.85,
        threshold: 0.8,
      }],
    });

    expect(alarm?.source).toBe('cloud');
    expect(alarm?.conditions).toHaveLength(1);
    expect(alarm?.absolute_value).toBe(0.85);
  });
});
