import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CheckCircle2,
  Download,
  MapPin,
  Maximize2,
  Radio,
  Satellite,
  Send,
  Terminal,
  Trash2,
} from 'lucide-react';
import AMapLoader from '@amap/amap-jsapi-loader';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface GnggaData {
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  quality: string;
  qualityCode: string;
  satellites: number;
  raw: string;
}

interface ImuData {
  acc: [number, number, number];
  gyro: [number, number, number];
  angle: [number, number, number];
}

interface AlarmData {
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
}

const ALARM_LEVEL_STYLE: Record<string, { bg: string; border: string; text: string; label: string }> = {
  RED: { bg: 'bg-red-50', border: 'border-red-500', text: 'text-red-700', label: '红色预警' },
  ORANGE: { bg: 'bg-orange-50', border: 'border-orange-500', text: 'text-orange-700', label: '橙色预警' },
  YELLOW: { bg: 'bg-amber-50', border: 'border-amber-500', text: 'text-amber-700', label: '黄色预警' },
  NORMAL: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', label: '正常' },
  GREEN: { bg: 'bg-green-50', border: 'border-green-500', text: 'text-green-700', label: '安全' },
};

const QUALITY_COLORS: Record<string, string> = {
  '0': '#94a3b8',
  '1': '#f59e0b',
  '2': '#3b82f6',
  '4': '#10b981',
  '5': '#8b5cf6',
};

const NUM_RE = '[-+]?\\d+(?:\\.\\d+)?';
const IMU_RE = new RegExp(
  `^(?:ACC:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+g|GYRO:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+deg\\/s|ANGLE:\\s*${NUM_RE}\\s+${NUM_RE}\\s+${NUM_RE}\\s+deg)$`,
);
const NMEA_RE = /^\$GNGGA,/;
const ALARM_RE = /^ALARM:\s+level=\w+\s+score=[\d.]+/;

function isValidMessage(msg: string): boolean {
  if (!msg || msg.length > 500) return false;
  return IMU_RE.test(msg) || NMEA_RE.test(msg) || ALARM_RE.test(msg);
}

function parseAlarm(s: string): AlarmData | null {
  const levelMatch = s.match(/level=(\w+)/);
  if (!levelMatch) return null;
  const get = (key: string) => {
    const match = s.match(new RegExp(`${key}=([\\d.]+)`));
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
    q: parseInt(s.match(/q=(\d+)/)?.[1] || '0', 10),
    sats: parseInt(s.match(/sats=(\d+)/)?.[1] || '0', 10),
  };
}

export default function Stm32Window() {
  const [data, setData] = useState<GnggaData>({
    latitude: null,
    longitude: null,
    altitude: null,
    quality: '等待数据',
    qualityCode: '0',
    satellites: 0,
    raw: '',
  });
  const [imu, setImu] = useState<ImuData>({ acc: [0, 0, 0], gyro: [0, 0, 0], angle: [0, 0, 0] });
  const [alarm, setAlarm] = useState<AlarmData | null>(null);
  const [angleAlert, setAngleAlert] = useState({ x: false, y: false, xOffset: 0, yOffset: 0 });
  const [displacementHistory, setDisplacementHistory] = useState<{ time: string; x: number; y: number; z: number }[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [mapTheme, setMapTheme] = useState<'dark' | 'normal' | 'satellite'>('dark');
  const [notifications, setNotifications] = useState<{ msg: string; type: 'success' | 'error' | 'info' | 'warning'; time: string }[]>([]);
  const [dataSource] = useState(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    const basePath = path.includes('/stm32') ? '/stm32' : '';
    return basePath ? `${basePath}/api` : '/api';
  });

  const logContainerRef = useRef<HTMLDivElement>(null);
  const lastRawRef = useRef('');
  const lastMessageSeqRef = useRef(0);
  const lastImuTimeRef = useRef(0);
  const lastGpsTimeRef = useRef(0);
  const last4gDataTimeRef = useRef(0);
  const prevOnlineRef = useRef(false);
  const prevDataRef = useRef<GnggaData | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<any[]>([]);

  const addNotification = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setNotifications((prev) => [{ msg, type, time }, ...prev.slice(0, 49)]);
  };

  const parseGngga = (nmea: string): GnggaData => {
    const parts = nmea.split(',');
    if (!parts[0] || !parts[0].includes('GGA')) return { ...data, raw: nmea };

    let lat = 0;
    if (parts[2] && parts[2].length > 4) {
      const degrees = parseFloat(parts[2].substring(0, 2));
      const minutes = parseFloat(parts[2].substring(2));
      lat = degrees + minutes / 60;
      if (parts[3] === 'S') lat = -lat;
    }

    let lon = 0;
    if (parts[4] && parts[4].length > 5) {
      const degrees = parseFloat(parts[4].substring(0, 3));
      const minutes = parseFloat(parts[4].substring(3));
      lon = degrees + minutes / 60;
      if (parts[5] === 'W') lon = -lon;
    }

    const qCode = parts[6] || '0';
    const qualityMap: Record<string, string> = {
      '0': '未定位',
      '1': '单点定位',
      '2': '差分定位',
      '4': 'RTK 固定解',
      '5': 'RTK 浮点解',
    };
    const sats = parseInt(parts[7] || '0', 10);
    const alt = parts[9] ? parseFloat(parts[9]) : null;

    return {
      latitude: lat !== 0 ? lat : data.latitude,
      longitude: lon !== 0 ? lon : data.longitude,
      altitude: alt !== null ? alt : data.altitude,
      quality: qualityMap[qCode] || '未知',
      qualityCode: qCode,
      satellites: sats,
      raw: nmea,
    };
  };

  const initMap = () => {
    if (!mapContainerRef.current) return;
    (window as any)._AMapSecurityConfig = { securityJsCode: '7427090a19ead0f132fd6dedad4a2d6a' };

    AMapLoader.load({
      key: '80d0f2e44986109a8c37f67194590127',
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.ControlBar', 'AMap.Polyline'],
    })
      .then((AMap) => {
        const layers = mapTheme === 'satellite' ? [new AMap.TileLayer.Satellite()] : [];
        const map = new AMap.Map(mapContainerRef.current, {
          zoom: 18,
          center: [117.993469, 36.810429],
          viewMode: '3D',
          pitch: 45,
          layers,
        });

        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar());

        const marker = new AMap.Marker({
          position: [117.993469, 36.810429],
          offset: new AMap.Pixel(-10, -10),
          content: '<div style="width:20px;height:20px;background:#f59e0b;border-radius:50%;border:2px solid white;box-shadow:0 0 10px rgba(245,158,11,.8)"></div>',
        });
        const polyline = new AMap.Polyline({
          path: pathRef.current,
          strokeColor: '#f59e0b',
          strokeWeight: 4,
          strokeOpacity: 0.8,
          lineJoin: 'round',
          showDir: true,
        });

        map.add(polyline);
        map.add(marker);
        mapRef.current = map;
        markerRef.current = marker;
        polylineRef.current = polyline;
      })
      .catch((e) => {
        console.error('AMap load error:', e);
        addNotification('地图加载失败，请检查 API Key 或网络', 'error');
      });
  };

  useEffect(() => {
    initMap();
    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.destroy();
    mapRef.current = null;
    markerRef.current = null;
    polylineRef.current = null;
    initMap();
  }, [mapTheme]);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !polylineRef.current || !data.longitude || !data.latitude) return;
    const pos = [data.longitude, data.latitude];
    markerRef.current.setPosition(pos);
    const lastPos = pathRef.current[pathRef.current.length - 1];
    if (!lastPos || Math.abs(lastPos[0] - pos[0]) > 0.0000001 || Math.abs(lastPos[1] - pos[1]) > 0.0000001) {
      pathRef.current = [...pathRef.current.slice(-999), pos];
      polylineRef.current.setPath(pathRef.current);
    }
    if (isLocked) mapRef.current.setCenter(pos);

    if (prevDataRef.current?.latitude && prevDataRef.current?.longitude) {
      const deltaLat = data.latitude - prevDataRef.current.latitude;
      const deltaLon = data.longitude - prevDataRef.current.longitude;
      const deltaAlt = (data.altitude || 0) - (prevDataRef.current.altitude || 0);
      const dy = deltaLat * 111320;
      const dx = deltaLon * 111320 * Math.cos((data.latitude * Math.PI) / 180);
      const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setDisplacementHistory((prev) => [...prev.slice(-29), { time: now, x: dx, y: dy, z: deltaAlt }]);
    }
    prevDataRef.current = data;
  }, [data.longitude, data.latitude, data.altitude, isLocked]);

  const clearPath = () => {
    pathRef.current = [];
    if (polylineRef.current) polylineRef.current.setPath([]);
    addNotification('轨迹已清除', 'info');
  };

  const exportTrajectory = () => {
    if (pathRef.current.length === 0) {
      addNotification('没有轨迹数据可导出', 'warning');
      return;
    }
    const csv = `longitude,latitude\n${pathRef.current.map((p) => `${p[0]},${p[1]}`).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trajectory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification(`轨迹已导出 (${pathRef.current.length} 个点)`, 'success');
  };

  useEffect(() => {
    let alive = true;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    const handleMessage = (msg: string, dataAgeMs?: number, seq?: number) => {
      if (seq !== undefined) {
        if (seq <= lastMessageSeqRef.current) return;
        lastMessageSeqRef.current = seq;
      }
      if (!msg || !isValidMessage(msg)) return;
      if (dataAgeMs !== undefined && dataAgeMs >= 5000) return;

      const now = Date.now();
      last4gDataTimeRef.current = now;

      if (msg.startsWith('ACC:') || msg.startsWith('GYRO:') || msg.startsWith('ANGLE:')) {
        const accMatch = msg.match(/ACC:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
        if (accMatch) setImu((prev) => ({ ...prev, acc: [parseFloat(accMatch[1]), parseFloat(accMatch[2]), parseFloat(accMatch[3])] }));
        const angleMatch = msg.match(/ANGLE:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
        if (angleMatch) setImu((prev) => ({ ...prev, angle: [parseFloat(angleMatch[1]), parseFloat(angleMatch[2]), parseFloat(angleMatch[3])] }));
        const gyroMatch = msg.match(/GYRO:\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
        if (gyroMatch) setImu((prev) => ({ ...prev, gyro: [parseFloat(gyroMatch[1]), parseFloat(gyroMatch[2]), parseFloat(gyroMatch[3])] }));
        lastImuTimeRef.current = now;
      } else if (msg.startsWith('$GNGGA,')) {
        setData(parseGngga(msg));
        lastGpsTimeRef.current = now;
      } else if (msg.startsWith('ALARM:')) {
        const alarmData = parseAlarm(msg);
        if (alarmData) {
          setAlarm(alarmData);
          if (!['NORMAL', 'GREEN'].includes(alarmData.level)) {
            const style = ALARM_LEVEL_STYLE[alarmData.level] || ALARM_LEVEL_STYLE.YELLOW;
            addNotification(`${style.label} | 风险分数: ${alarmData.score} | 位移: ${alarmData.D}mm | 倾角: ${alarmData.tilt}°`, alarmData.level === 'RED' ? 'error' : 'warning');
          }
        }
      }

      const logLine = msg.startsWith('ALARM:')
        ? `⚠️ ${parseAlarm(msg)?.level || '?'} | 风险:${parseAlarm(msg)?.score || 0} | 位移:${parseAlarm(msg)?.D || 0}mm | 倾角:${parseAlarm(msg)?.tilt || 0}°`
        : msg;
      if (logLine !== lastRawRef.current) {
        setLogs((prev) => [...prev.slice(-199), logLine]);
        lastRawRef.current = logLine;
      }
    };

    const handlePayload = (json: any) => {
      if (json.imu && (json.data_age_ms === undefined || json.data_age_ms < 5000)) {
        setImu((prev) => ({
          acc: Array.isArray(json.imu.acc) ? json.imu.acc : prev.acc,
          gyro: Array.isArray(json.imu.gyro) ? json.imu.gyro : prev.gyro,
          angle: Array.isArray(json.imu.angle) ? json.imu.angle : prev.angle,
        }));
        lastImuTimeRef.current = Date.now();
        last4gDataTimeRef.current = Date.now();
      }

      if (Array.isArray(json.messages) && json.messages.length > 0) {
        [...json.messages]
          .sort((a, b) => (a.seq || 0) - (b.seq || 0))
          .forEach((item) => {
            if (item?.message) handleMessage(item.message, json.data_age_ms, item.seq);
          });
        return;
      }
      if (json.message) handleMessage(json.message, json.data_age_ms, json.message_seq);
    };

    const buildWsUrl = () => {
      const host = window.location.host;
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${host}${dataSource}/ws`;
    };

    const fetchFallback = async () => {
      try {
        const response = await fetch(`${dataSource}/data`);
        if (!response.ok) throw new Error('Network error');
        handlePayload(await response.json());
      } catch {
        // Online state is handled by timeout.
      }
    };

    const connectWs = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(buildWsUrl());
        wsRef.current = ws;
        ws.onopen = () => {
          if (fallbackInterval) {
            clearInterval(fallbackInterval);
            fallbackInterval = null;
          }
        };
        ws.onmessage = (event) => {
          try {
            handlePayload(JSON.parse(event.data));
          } catch {
            // Ignore non-JSON messages.
          }
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (alive) reconnectTimerRef.current = setTimeout(connectWs, 3000);
        };
        ws.onerror = () => ws.close();
      } catch {
        if (!fallbackInterval && alive) fallbackInterval = setInterval(fetchFallback, 200);
      }
    };

    connectWs();
    fallbackInterval = setInterval(fetchFallback, 200);

    return () => {
      alive = false;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [dataSource]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      if (lastImuTimeRef.current > 0 && now - lastImuTimeRef.current > 1000) {
        setImu({ acc: [0, 0, 0], gyro: [0, 0, 0], angle: [0, 0, 0] });
        lastImuTimeRef.current = 0;
      }
      if (lastGpsTimeRef.current > 0 && now - lastGpsTimeRef.current > 3000) {
        setData({ latitude: null, longitude: null, altitude: null, quality: '等待数据', qualityCode: '0', satellites: 0, raw: '' });
        lastGpsTimeRef.current = 0;
      }
      setIsOnline(last4gDataTimeRef.current > 0 && now - last4gDataTimeRef.current < 5000);
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const [ax, ay] = imu.angle;
    const xOffset = Math.abs(ax);
    const yOffset = Math.abs(ay);
    setAngleAlert({ x: xOffset > 5, y: yOffset > 5, xOffset, yOffset });
  }, [imu.angle]);

  useEffect(() => {
    if (isOnline && !prevOnlineRef.current) addNotification('设备已上线 (4G)', 'success');
    if (!isOnline && prevOnlineRef.current) addNotification('设备已下线', 'error');
    prevOnlineRef.current = isOnline;
  }, [isOnline]);

  useEffect(() => {
    const el = logContainerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const sendCmd = async () => {
    if (!command.trim()) return;
    const currentCmd = command.trim();
    setCommand('');
    try {
      const response = await fetch(`${dataSource}/send_cmd?cmd=${encodeURIComponent(currentCmd)}`);
      const result = await response.json();
      addNotification(`指令 [${currentCmd}] ${result.status === 'success' ? '已下发' : '失败'}: ${result.msg || ''}`, result.status === 'success' ? 'success' : 'error');
    } catch {
      addNotification('指令发送失败，请检查网络', 'error');
    }
  };

  const sendPresetCommand = async (val: string, label: string) => {
    setCommand(val);
    try {
      const response = await fetch(`${dataSource}/send_cmd?cmd=${encodeURIComponent(val)}`);
      const result = await response.json();
      addNotification(`指令 [${label}] ${result.status === 'success' ? '已下发' : '失败'}: ${result.msg || ''}`, result.status === 'success' ? 'success' : 'error');
    } catch {
      addNotification('指令发送失败，请检查网络', 'error');
    }
  };

  const alarmSummary: AlarmData = alarm || {
    level: 'NORMAL',
    score: 0,
    D: 0,
    V: 0,
    E: 0,
    N: 0,
    U: 0,
    tilt: 0,
    accDyn: 0,
    q: 0,
    sats: 0,
  };
  const alarmStyle = ALARM_LEVEL_STYLE[alarmSummary.level] || ALARM_LEVEL_STYLE.YELLOW;
  const hasActiveAlarm = alarm ? !['NORMAL', 'GREEN'].includes(alarm.level) : false;

  return (
    <div className="min-h-screen tool-window-bg flex flex-col">
      {hasActiveAlarm && alarm && (
        <div className="fixed top-4 right-4 z-[101] w-[340px]">
          <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} className={`${alarmStyle.bg} border-2 ${alarmStyle.border} rounded-xl shadow-lg p-4`}>
            <div className="flex items-start gap-3">
              <AlertCircle className={`w-6 h-6 shrink-0 ${alarmStyle.text}`} />
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-bold mb-2 ${alarmStyle.text}`}>{alarmStyle.label}</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-[#6d5a47]">
                  <span>风险分数: <b>{alarm.score}</b></span>
                  <span>有效位移: <b>{alarm.D} mm</b></span>
                  <span>合倾角: <b>{alarm.tilt}°</b></span>
                  <span>动态加速度: <b>{alarm.accDyn} g</b></span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {(angleAlert.x || angleAlert.y) && (
        <div className="fixed top-40 right-4 z-[99] w-[320px]">
          <motion.div initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} className="bg-red-50 border-2 border-red-400 rounded-xl shadow-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-red-700 mb-2">边坡姿态预警</div>
                {angleAlert.x && <div className="text-xs text-red-600">X轴偏移超限: {angleAlert.xOffset.toFixed(1)}°</div>}
                {angleAlert.y && <div className="text-xs text-red-600">Y轴偏移超限: {angleAlert.yOffset.toFixed(1)}°</div>}
              </div>
            </div>
          </motion.div>
        </div>
      )}

      <main className="flex-1 overflow-hidden p-4 gap-4 flex">
        <div className="w-[520px] flex flex-col gap-3 shrink-0">
          <div className={`glass-card rounded-2xl p-4 border-2 ${alarmStyle.border} ${alarmStyle.bg}`}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <AlertCircle className={`w-4 h-4 ${alarmStyle.text}`} />
                <span className={`text-sm font-bold ${alarmStyle.text}`}>{alarmStyle.label}</span>
              </div>
              <span className={`px-2 py-0.5 rounded-full text-xs font-bold border ${alarmStyle.border} ${alarmStyle.text}`}>风险分数: {alarmSummary.score}</span>
            </div>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2 text-xs text-[#6d5a47]">
              <span>有效位移: <b>{alarmSummary.D} mm</b></span>
              <span>位移速率: <b>{alarmSummary.V} mm/min</b></span>
              <span>东向位移: <b>{alarmSummary.E} mm</b></span>
              <span>北向位移: <b>{alarmSummary.N} mm</b></span>
              <span>高程变化: <b>{alarmSummary.U} mm</b></span>
              <span>合倾角: <b>{alarmSummary.tilt}°</b></span>
              <span>动态加速度: <b>{alarmSummary.accDyn} g</b></span>
              <span>定位质量: <b>q={alarmSummary.q}</b> | <b>{alarmSummary.sats} 颗卫星</b></span>
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Satellite className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-bold text-[#2f241b]">UM980 数据</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '经度', value: `${data.longitude?.toFixed(7) || '--'}°`, icon: <MapPin className="w-3 h-3 text-amber-600" /> },
                { label: '纬度', value: `${data.latitude?.toFixed(7) || '--'}°`, icon: <MapPin className="w-3 h-3 text-orange-600" /> },
                { label: '海拔', value: `${data.altitude?.toFixed(2) || '--'} m`, icon: <Maximize2 className="w-3 h-3 text-red-600" /> },
                { label: '定位状态', value: data.quality, icon: <Activity className="w-3 h-3 text-green-600" />, valueColor: QUALITY_COLORS[data.qualityCode] || '#94a3b8' },
                { label: '卫星数量', value: `${data.satellites.toString().padStart(2, '0')} 颗`, icon: <Satellite className="w-3 h-3 text-amber-600" /> },
                { label: '质量 q', value: data.qualityCode, icon: <Radio className="w-3 h-3 text-blue-600" /> },
              ].map((item, i) => (
                <div key={i} className="bg-[#fff4e6] p-3 rounded-xl border border-[#d8b58e]">
                  <div className="flex items-center gap-1 mb-1">{item.icon}<span className="text-[10px] text-[#8b735c] font-bold">{item.label}</span></div>
                  <div className="text-sm font-mono font-bold" style={{ color: (item as any).valueColor || '#2f241b' }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-bold text-[#2f241b]">IMU 惯性数据</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                <div key={`acc-${axis}`} className="bg-[#fff4e6] p-2 rounded-xl border border-[#d8b58e]">
                  <span className="text-[9px] text-[#8b735c] font-bold">加速度 {axis}</span>
                  <div className="text-sm font-mono text-[#6f3714] font-bold">{imu.acc[i].toFixed(3)} <span className="text-[10px] text-[#8b735c]">g</span></div>
                  <div className="h-1 bg-[#f1dcc2] rounded-full mt-1"><div className="h-full bg-purple-500 rounded-full" style={{ width: `${Math.min(Math.abs(imu.acc[i]) * 100, 100)}%` }} /></div>
                </div>
              ))}
              {(['X', 'Y', 'Z'] as const).map((axis, i) => {
                const offset = Math.abs(imu.angle[i]);
                const isAlert = i < 2 && offset > 5;
                return (
                  <div key={`angle-${axis}`} className={`bg-[#fff4e6] p-2 rounded-xl border ${isAlert ? 'border-red-400' : 'border-[#d8b58e]'}`}>
                    <span className="text-[9px] text-[#8b735c] font-bold">姿态角 {axis}</span>
                    <div className="text-sm font-mono font-bold" style={{ color: isAlert ? '#dc2626' : '#f59e0b' }}>{imu.angle[i].toFixed(3)} <span className="text-[10px] text-[#8b735c]">°</span></div>
                    <div className="h-1 bg-[#f1dcc2] rounded-full mt-1"><div className="h-full rounded-full" style={{ width: `${Math.min(Math.abs(imu.angle[i]) / 360 * 100, 100)}%`, background: isAlert ? '#dc2626' : '#f59e0b' }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Send className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-bold text-[#2f241b]">指令下发</span>
            </div>
            <select
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                const val = e.target.value;
                const label = e.target.selectedOptions[0]?.text || val;
                sendPresetCommand(val, label);
                e.target.value = '';
              }}
              className="w-full bg-[#fff4e6] border border-[#d8b58e] rounded-xl p-2.5 text-sm text-[#2f241b] focus:outline-none focus:border-[#9a5a28] cursor-pointer"
            >
              <option value="">选择预设指令</option>
              <option value="0">0: 重设当前 RTK 固定解位置为参考点</option>
              <option value="1">1: 系统初始化</option>
              <option value="2">2: 流动站配置</option>
              <option value="3">3: 开启 GPGGA 1秒输出</option>
              <option value="4">4: 开启 GPGGA 0.5秒输出</option>
              <option value="5">5: 关闭 GPGGA</option>
              <option value="6">6: 开启星历</option>
              <option value="7">7: 关闭星历</option>
              <option value="8">8: 开启原始数据</option>
              <option value="9">9: 关闭原始数据</option>
            </select>
            <textarea
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendCmd();
                }
              }}
              placeholder="输入自定义指令..."
              className="w-full h-14 bg-[#fff4e6] border border-[#d8b58e] rounded-xl p-3 text-sm font-mono text-[#2f241b] placeholder:text-[#b8a089] focus:outline-none focus:border-[#9a5a28] resize-none"
            />
            <button onClick={sendCmd} disabled={!command.trim()} className="w-full py-2.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 disabled:from-gray-300 disabled:to-gray-300 text-white rounded-xl text-sm font-bold transition-all">
              发送 (Enter)
            </button>
          </div>
        </div>

        <div className="w-[360px] flex flex-col bg-[#fff4e6] rounded-2xl border border-[#d8b58e] overflow-hidden shrink-0 min-h-0">
          <div className="px-4 py-2 bg-[#f1dcc2] border-b border-[#d8b58e] flex justify-between items-center">
            <div className="flex items-center gap-2 text-xs font-bold text-[#6f3714]"><Terminal className="w-3 h-3" />NMEA 监视器</div>
            <button onClick={() => setLogs([])} className="p-1 hover:bg-[#ead0ad] rounded text-[#8b735c] hover:text-red-500 transition-colors"><Trash2 className="w-3 h-3" /></button>
          </div>
          <div ref={logContainerRef} className="h-[300px] overflow-y-auto p-3 font-mono text-[10px] space-y-1">
            {logs.map((log, i) => (
              <div key={`${log}-${i}`} className="text-[#5c4937] break-all leading-tight border-l border-[#b47a43] pl-2">
                <span className="text-[#8b735c] mr-1">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>{log}
              </div>
            ))}
          </div>
          <div className="glass-card rounded-2xl p-3 h-[220px] min-h-[220px] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-bold text-[#2f241b]">系统通知</div>
              <button onClick={() => setNotifications([])} className="text-[10px] text-[#8b735c] hover:text-red-500 transition-colors">清空</button>
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 min-h-0">
              {notifications.length === 0 && <p className="text-xs text-gray-300 text-center py-2">暂无通知</p>}
              {notifications.map((n, i) => (
                <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} key={`${n.time}-${i}`} className={`p-1.5 rounded-lg border text-xs flex gap-2 ${
                  n.type === 'success' ? 'bg-green-50 border-green-200 text-green-700' :
                  n.type === 'error' ? 'bg-red-50 border-red-200 text-red-700' :
                  n.type === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                  'bg-blue-50 border-blue-200 text-blue-700'
                }`}>
                  {n.type === 'success' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : <AlertCircle className="w-3 h-3 shrink-0" />}
                  <span className="text-[10px] text-gray-400 shrink-0">{n.time}</span>
                  <div>{n.msg}</div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-[420px] flex flex-col gap-4 overflow-hidden">
          <div className="flex-[2] glass-card rounded-2xl overflow-hidden relative min-h-[250px]">
            <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
              <div className="px-3 py-1.5 bg-white/90 border border-[#d8b58e] rounded-lg backdrop-blur-md flex items-center gap-2">
                <Maximize2 className="w-3 h-3 text-amber-600" />
                <span className="text-xs font-bold text-[#2f241b]">实时轨迹地图</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setIsLocked(!isLocked)} className={`px-3 py-1.5 rounded-lg border backdrop-blur-md text-xs font-bold transition-all flex items-center gap-2 ${isLocked ? 'bg-amber-500/20 border-amber-500/50 text-amber-700' : 'bg-white/90 border-[#d8b58e] text-[#6d5a47]'}`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-amber-500' : 'bg-gray-400'}`} />{isLocked ? '视角锁定' : '自由视角'}
                </button>
                <button onClick={clearPath} className="px-3 py-1.5 bg-white/90 border border-[#d8b58e] rounded-lg backdrop-blur-md text-xs font-bold text-[#6d5a47] hover:text-red-500 transition-all flex items-center gap-2"><Trash2 className="w-3 h-3" />清除轨迹</button>
                <button onClick={exportTrajectory} className="px-3 py-1.5 bg-white/90 border border-[#d8b58e] rounded-lg backdrop-blur-md text-xs font-bold text-[#6d5a47] hover:text-green-600 transition-all flex items-center gap-2"><Download className="w-3 h-3" />导出</button>
              </div>
            </div>
            <div className="absolute top-4 right-4 z-10 flex gap-1 p-1 bg-white/90 border border-[#d8b58e] rounded-lg backdrop-blur-md">
              {(['dark', 'normal', 'satellite'] as const).map((t) => (
                <button key={t} onClick={() => setMapTheme(t)} className={`px-2 py-1 rounded text-xs font-bold transition-all ${mapTheme === t ? 'bg-amber-600 text-white' : 'text-[#8b735c] hover:text-[#2f241b]'}`}>
                  {t === 'dark' ? '深色' : t === 'normal' ? '标准' : '卫星'}
                </button>
              ))}
            </div>
            <div ref={mapContainerRef} className="w-full h-full" />
          </div>

          <div className="flex-[1] glass-card rounded-2xl p-4 flex flex-col gap-2 min-h-[200px]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-amber-600" /><span className="text-sm font-bold text-[#2f241b]">XYZ 三轴位移变化</span></div>
              <span className="text-[10px] text-[#8b735c]">每秒采样</span>
            </div>
            <div className="flex-1 flex flex-col gap-2 overflow-y-auto">
              {[
                { key: 'x', label: 'X (东/西)', color: '#f59e0b', dataKey: 'x' },
                { key: 'y', label: 'Y (南/北)', color: '#10b981', dataKey: 'y' },
                { key: 'z', label: 'Z (高度)', color: '#ef4444', dataKey: 'z' },
              ].map((chart) => (
                <div key={chart.key} className="bg-[#fff4e6] rounded-xl border border-[#d8b58e] p-2 h-[70px]">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: chart.color }} /><span className="text-[10px] text-[#8b735c] font-bold">{chart.label}</span></div>
                    <span className="text-[10px] font-mono" style={{ color: chart.color }}>{displacementHistory.length > 0 ? displacementHistory[displacementHistory.length - 1][chart.dataKey as 'x' | 'y' | 'z'].toFixed(3) : '0.000'} m</span>
                  </div>
                  <div className="h-[45px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={displacementHistory}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d8b58e" vertical={false} />
                        <XAxis dataKey="time" hide />
                        <YAxis stroke="#8b735c" fontSize={8} tickLine={false} axisLine={false} width={25} />
                        <Tooltip contentStyle={{ backgroundColor: '#fff4e6', border: '1px solid #d8b58e', borderRadius: '8px', fontSize: '10px' }} />
                        <Line type="monotone" dataKey={chart.dataKey} stroke={chart.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="sticky bottom-0 glass-sidebar border-t border-[#dcc2a3] px-6 py-3">
        <div className="flex items-center justify-between text-xs text-[#6d5a47]">
          <div className="flex items-center gap-3">
            <span>智感边坡-北斗高精度边坡上位机平台</span>
            <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border ${isOnline ? 'bg-green-50 border-green-300 text-green-700' : 'bg-red-50 border-red-300 text-red-700'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
              {isOnline ? '4G 设备在线' : '4G 设备离线'}
            </span>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2"><Radio className="w-3 h-3" />传输协议: NMEA-0183</div>
            <div className="flex items-center gap-2"><Activity className="w-3 h-3" />波特率: 115200</div>
            <div className="flex items-center gap-2"><Satellite className="w-3 h-3" />{data.satellites} 颗卫星</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
