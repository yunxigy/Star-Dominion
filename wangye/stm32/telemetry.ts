import type { AlarmCondition, AlarmData, AlarmMetric, DeviceRecord, DeviceMessage, GnggaData, ImuData, GnssDisplacement } from './types';

export const QUALITY_COLORS: Record<string, string> = {
  '0': '#94a3b8',
  '1': '#f59e0b',
  '2': '#38bdf8',
  '4': '#22d3ee',
  '5': '#a78bfa',
};

export const QUALITY_NAMES: Record<string, string> = {
  '0': '未定位',
  '1': '单点定位',
  '2': '差分定位',
  '4': 'RTK 固定解',
  '5': 'RTK 浮点解',
};

export const EMPTY_IMU: ImuData = {
  acc: [0, 0, 0],
  gyro: [0, 0, 0],
  angle: [0, 0, 0],
};

export const EMPTY_DATA: GnggaData = {
  latitude: null,
  longitude: null,
  altitude: null,
  quality: '等待数据',
  qualityCode: '0',
  satellites: 0,
  raw: '',
};

const NUM_RE = '[-+]?\\d+(?:\\.\\d+)?';
const IMU_RE = new RegExp(
  `^(?:ACC:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+g|GYRO:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+deg\\/s|ANGLE:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+deg)$`,
);
const NMEA_RE = /^\$[A-Z]{2}GGA,/;
const ALARM_RE = /^ALARM:\s+level=\w+\s+score=[\d.]+/;
const ENVIRONMENT_RE = new RegExp(
  `^TEMP(?:ERATURE)?:\\s*(${NUM_RE})\\s*(?:°?C|℃)?\\s*(?:[,;]\\s*|\\s+)HUM(?:I|IDITY)?:\\s*(${NUM_RE})\\s*(?:%RH|RH|%)?$`,
  'i',
);

export function isValidMessage(message: string): boolean {
  if (!message || message.length > 500) return false;
  return IMU_RE.test(message) || NMEA_RE.test(message) || ALARM_RE.test(message) || ENVIRONMENT_RE.test(message);
}

export function parseAlarm(message: string): AlarmData | null {
  const levelMatch = message.match(/level=(\w+)/);
  if (!levelMatch) return null;
  const get = (key: string) => {
    const match = message.match(new RegExp(`${key}=([\\d.]+)`));
    return match ? parseFloat(match[1]) : 0;
  };
  return {
    level: levelMatch[1],
    score: get('score'),
    D: get('D'),
    V: get('V'),
    E: get('E'),
    N: get('N'),
    U: get('U'),
    tilt: get('tilt'),
    accDyn: get('accDyn'),
    q: parseInt(message.match(/q=(\d+)/)?.[1] || '0', 10),
    sats: parseInt(message.match(/sats=(\d+)/)?.[1] || '0', 10),
  };
}

export function parseEnvironmentMessage(message: string): { temperature: number; humidity: number } | null {
  const match = message.match(ENVIRONMENT_RE);
  if (!match) return null;
  return {
    temperature: Number(match[1]),
    humidity: Number(match[2]),
  };
}

export function parseGnggaMessage(nmea: string): {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  quality_code: string;
  quality: string;
  satellites: number;
} | null {
  const parts = nmea.split(',');
  if (!parts[0]?.includes('GGA')) return null;

  const parseCoordinate = (
    value: string | undefined,
    hemisphere: string | undefined,
    degreeDigits: number,
  ): number | null => {
    if (!value || value.length <= degreeDigits) return null;
    const degrees = Number(value.slice(0, degreeDigits));
    const minutes = Number(value.slice(degreeDigits));
    if (!Number.isFinite(degrees) || !Number.isFinite(minutes) || minutes < 0 || minutes >= 60) return null;
    const coordinate = degrees + minutes / 60;
    return ['S', 'W'].includes(hemisphere || '') ? -coordinate : coordinate;
  };

  const qualityCode = parts[6] || '0';
  const altitude = nullableNumber(parts[9]);
  return {
    latitude: parseCoordinate(parts[2], parts[3], 2),
    longitude: parseCoordinate(parts[4], parts[5], 3),
    altitude,
    quality_code: qualityCode,
    quality: QUALITY_NAMES[qualityCode] || '未知',
    satellites: Math.max(0, Math.round(asFiniteNumber(parts[7], 0))),
  };
}

export function normalizeVector(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback] as [number, number, number];
  return [
    asFiniteNumber(value[0], fallback[0]),
    asFiniteNumber(value[1], fallback[1]),
    asFiniteNumber(value[2], fallback[2]),
  ];
}

export function normalizeAlarm(value: unknown): AlarmData | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const metric = ['acc_x', 'acc_y', 'angle_x', 'angle_y', 'angle_z'].includes(String(source.metric))
    ? String(source.metric) as AlarmMetric
    : undefined;
  const conditions: AlarmCondition[] = Array.isArray(source.conditions)
    ? source.conditions.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const condition = item as Record<string, unknown>;
      const conditionMetric = ['acc_x', 'acc_y', 'angle_x', 'angle_y', 'angle_z'].includes(String(condition.metric))
        ? String(condition.metric) as AlarmMetric
        : null;
      const valueNumber = nullableNumber(condition.value);
      const absoluteNumber = nullableNumber(condition.absolute_value);
      const thresholdNumber = nullableNumber(condition.threshold);
      if (!conditionMetric || valueNumber === null || absoluteNumber === null || thresholdNumber === null) return [];
      return [{
        metric: conditionMetric,
        label: typeof condition.label === 'string' ? condition.label : conditionMetric,
        value: valueNumber,
        absolute_value: absoluteNumber,
        threshold: thresholdNumber,
        ...(typeof condition.unit === 'string' ? { unit: condition.unit } : {}),
      }];
    })
    : [];
  return {
    level: String(source.level ?? 'NORMAL'),
    score: asFiniteNumber(source.score, 0),
    D: asFiniteNumber(source.D, 0),
    V: asFiniteNumber(source.V, 0),
    E: asFiniteNumber(source.E, 0),
    N: asFiniteNumber(source.N, 0),
    U: asFiniteNumber(source.U, 0),
    tilt: asFiniteNumber(source.tilt, 0),
    accDyn: asFiniteNumber(source.accDyn, 0),
    q: Math.max(0, Math.round(asFiniteNumber(source.q, 0))),
    sats: Math.max(0, Math.round(asFiniteNumber(source.sats, 0))),
    ...(typeof source.source === 'string' ? { source: source.source } : {}),
    ...(metric ? { metric } : {}),
    ...(typeof source.label === 'string' ? { label: source.label } : {}),
    ...(nullableNumber(source.value) !== null ? { value: nullableNumber(source.value) as number } : {}),
    ...(nullableNumber(source.absolute_value) !== null ? { absolute_value: nullableNumber(source.absolute_value) as number } : {}),
    ...(nullableNumber(source.threshold) !== null ? { threshold: nullableNumber(source.threshold) as number } : {}),
    ...(typeof source.unit === 'string' ? { unit: source.unit } : {}),
    ...(conditions.length > 0 ? { conditions } : {}),
    ...(typeof source.message === 'string' ? { message: source.message } : {}),
    ...(nullableNumber(source.triggered_at_ms) !== null ? { triggered_at_ms: nullableNumber(source.triggered_at_ms) as number } : {}),
  };
}

export function normalizeGnss(value: unknown): GnssDisplacement | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, any>;
  const vector = (item: unknown): [number, number, number] | null => {
    if (!Array.isArray(item) || item.length !== 3 || !item.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    return [item[0], item[1], item[2]];
  };
  const history = (Array.isArray(source.history) ? source.history : []).slice(-300).flatMap((point: any) => {
    const raw = vector(point?.raw_enu_mm);
    const filtered = vector(point?.filtered_enu_mm);
    if (!raw || !filtered || typeof point.utc !== 'string') return [];
    const utc = point.utc;
    return [{ time: `${utc.slice(0, 2)}:${utc.slice(2, 4)}:${utc.slice(4, 6)} UTC`,
      x: filtered[0] / 10, y: filtered[1] / 10, z: filtered[2] / 10,
      raw_x: raw[0] / 10, raw_y: raw[1] / 10, raw_z: raw[2] / 10 }];
  });
  return {
    status: String(source.status || 'no_data'), valid: source.valid === true,
    reference_id: typeof source.reference_id === 'string' ? source.reference_id : null,
    reference_progress: asFiniteNumber(source.reference_progress, 0),
    reference_required: asFiniteNumber(source.reference_required, 20),
    sequence: asFiniteNumber(source.sequence, 0), persistence_error: source.persistence_error === true,
    filtered_enu_mm: vector(source.filtered_enu_mm), history,
  };
}

export function normalizeDevice(id: string, value: unknown): DeviceRecord {
  const source = value && typeof value === 'object' ? value as Record<string, any> : {};
  const deviceId = String(source.device_id ?? id);
  const serverTimestamp = asFiniteNumber(source.server_timestamp, 0);
  const dataAge = Math.max(0, asFiniteNumber(
    source.data_age_ms,
    serverTimestamp > 0 ? Math.max(Date.now() - serverTimestamp, 0) : 0,
  ));
  const sourceMessage = typeof source.message === 'string' ? source.message : '';
  const sourceMessages = Array.isArray(source.messages) ? source.messages : [];
  const messages: DeviceMessage[] = sourceMessages
    .map((item: any, index: number) => ({
      seq: asFiniteNumber(item?.seq, index + 1),
      message: typeof item?.message === 'string' ? item.message : '',
      raw: typeof item?.raw === 'string' ? item.raw : undefined,
      device_id: String(item?.device_id ?? deviceId),
      server_timestamp: asFiniteNumber(item?.server_timestamp, serverTimestamp),
    }))
    .filter((item: DeviceMessage) => item.message.length > 0);

  const stripPrefix = (message: string): string => {
    const prefix = `${deviceId},`;
    return message.startsWith(prefix) ? message.slice(prefix.length) : message;
  };
  const payloads = [sourceMessage, ...messages.map((item) => item.message)].map(stripPrefix).filter(Boolean);
  const parsedGngga = payloads.map(parseGnggaMessage).find((value) => value !== null) || null;
  const parsedEnvironment = payloads.map(parseEnvironmentMessage).find((value) => value !== null) || null;
  const sourceLatitude = nullableNumber(source.latitude);
  const sourceLongitude = nullableNumber(source.longitude);
  const hasSourcePosition = sourceLatitude !== null && sourceLongitude !== null && !(sourceLatitude === 0 && sourceLongitude === 0);
  const latitude = hasSourcePosition ? sourceLatitude : parsedGngga?.latitude ?? sourceLatitude;
  const longitude = hasSourcePosition ? sourceLongitude : parsedGngga?.longitude ?? sourceLongitude;
  const qualityCode = String(source.quality_code ?? source.qualityCode ?? parsedGngga?.quality_code ?? '0');
  const sourceSatellites = source.satellites === undefined ? null : nullableNumber(source.satellites);
  const satellites = Math.max(0, Math.round(sourceSatellites ?? parsedGngga?.satellites ?? 0));
  const sourceImu = source.imu && typeof source.imu === 'object' ? source.imu : {};
  const alarm = normalizeAlarm(source.alarm);
  const quality = String(source.quality ?? parsedGngga?.quality ?? source.rtk_status ?? QUALITY_NAMES[qualityCode] ?? '等待数据');

  return {
    device_id: deviceId,
    online: typeof source.online === 'boolean' ? source.online : serverTimestamp > 0 && dataAge < 5000,
    data_age_ms: dataAge,
    latitude,
    longitude,
    altitude: nullableNumber(source.altitude) ?? parsedGngga?.altitude ?? null,
    quality_code: qualityCode,
    quality,
    satellites,
    temperature: nullableNumber(source.temperature) ?? parsedEnvironment?.temperature ?? null,
    humidity: nullableNumber(source.humidity) ?? parsedEnvironment?.humidity ?? null,
    rtk_status: String(source.rtk_status ?? quality),
    message: sourceMessage,
    last_message: String(source.last_message ?? sourceMessage),
    raw: String(source.raw ?? source.last_message ?? sourceMessage),
    server_timestamp: serverTimestamp,
    message_seq: Math.max(0, Math.round(asFiniteNumber(source.message_seq, messages[messages.length - 1]?.seq ?? 0))),
    imu: {
      acc: normalizeVector(sourceImu.acc, EMPTY_IMU.acc),
      gyro: normalizeVector(sourceImu.gyro, EMPTY_IMU.gyro),
      angle: normalizeVector(sourceImu.angle, EMPTY_IMU.angle),
    },
    alarm,
    messages,
    gnss: normalizeGnss(source.gnss),
  };
}

export function formatDataAge(dataAgeMs: number): string {
  if (!Number.isFinite(dataAgeMs) || dataAgeMs < 0) return '--';
  if (dataAgeMs < 1000) return '<1 秒前';
  return `${Math.floor(dataAgeMs / 1000)} 秒前`;
}

export function formatLogTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '--:--:--';
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false });
}

export function deviceColor(device: DeviceRecord): string {
  if (!device.online) return '#64748b';
  return QUALITY_COLORS[device.quality_code] || '#f59e0b';
}

export function stripDevicePrefix(deviceId: string, message: string): string {
  const prefix = `${deviceId},`;
  return message.startsWith(prefix) ? message.slice(prefix.length) : message;
}

export function asFiniteNumber(value: unknown, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
