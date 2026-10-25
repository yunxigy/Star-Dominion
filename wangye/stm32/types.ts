export type MapTheme = 'dark' | 'normal' | 'satellite';

export interface GnggaData {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  quality: string;
  qualityCode: string;
  satellites: number;
  raw: string;
}

export interface ImuData {
  acc: [number, number, number];
  gyro: [number, number, number];
  angle: [number, number, number];
}

export type AlarmMetric = 'acc_x' | 'acc_y' | 'angle_x' | 'angle_y' | 'angle_z';

export interface AlarmSettings {
  acc_x: number | null;
  acc_y: number | null;
  angle_x: number | null;
  angle_y: number | null;
  angle_z: number | null;
}

export interface AlarmCondition {
  metric: AlarmMetric;
  label: string;
  value: number;
  absolute_value: number;
  threshold: number;
  unit?: string;
}

export interface AlarmData {
  level: string;
  score: number;
  D: number;
  V: number;
  E: number;
  N: number;
  U: number;
  tilt: number;
  accDyn: number;
  q: number;
  sats: number;
  source?: string;
  metric?: AlarmMetric;
  label?: string;
  value?: number;
  absolute_value?: number;
  threshold?: number;
  unit?: string;
  conditions?: AlarmCondition[];
  message?: string;
  triggered_at_ms?: number;
}

export interface DeviceMessage {
  seq: number;
  message: string;
  raw?: string;
  device_id?: string;
  server_timestamp?: number;
}

export interface LogEntry {
  deviceId: string;
  seq: number;
  text: string;
  timestamp: number;
}

export interface DisplacementPoint {
  time: string;
  // Fixed-reference ENU, in centimetres; x/y/z are filtered values.
  x: number;
  y: number;
  z: number;
  raw_x?: number;
  raw_y?: number;
  raw_z?: number;
}

export interface GnssDisplacement {
  status: string;
  valid: boolean;
  reference_id: string | null;
  reference_progress: number;
  reference_required: number;
  sequence: number;
  persistence_error: boolean;
  filtered_enu_mm: [number, number, number] | null;
  history: DisplacementPoint[];
}

export interface NotificationItem {
  msg: string;
  type: 'success' | 'error' | 'info' | 'warning';
  time: string;
}

export interface DeviceRecord {
  device_id: string;
  online: boolean;
  data_age_ms: number;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  quality_code: string;
  quality: string;
  satellites: number;
  temperature: number | null;
  humidity: number | null;
  rtk_status: string;
  message: string;
  last_message: string;
  raw: string;
  server_timestamp: number;
  message_seq: number;
  imu: ImuData;
  alarm: AlarmData | null;
  messages: DeviceMessage[];
  gnss?: GnssDisplacement | null;
}

export interface DeviceSnapshot {
  devices: Record<string, Partial<DeviceRecord>>;
  server_timestamp?: number;
  alarm_settings?: AlarmSettings;
  alarm_settings_updated_at_ms?: number;
  alarm_settings_revision?: number;
}
