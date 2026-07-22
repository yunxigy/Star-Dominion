import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cpu, Radio, Send, Terminal, Activity, Satellite, MapPin, AlertCircle, CheckCircle2, Trash2, Maximize2, BarChart3, Download, Settings } from 'lucide-react';
import AMapLoader from '@amap/amap-jsapi-loader';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Stm32ConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
}

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
}

const QUALITY_COLORS: Record<string, string> = {
  '0': '#94a3b8',
  '1': '#f59e0b',
  '2': '#3b82f6',
  '4': '#10b981',
  '5': '#8b5cf6',
};

export const Stm32ConsoleModal: React.FC<Stm32ConsoleModalProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<GnggaData>({
    latitude: null, longitude: null, altitude: null,
    quality: '等待数据', qualityCode: '0', satellites: 0, raw: ''
  });
  const [imu, setImu] = useState<ImuData>({ acc: [0, 0, 0], gyro: [0, 0, 0] });
  const [displacementHistory, setDisplacementHistory] = useState<{ time: string; x: number; y: number; z: number }[]>([]);
  const prevDataRef = useRef<GnggaData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [mapTheme, setMapTheme] = useState<'dark' | 'normal' | 'satellite'>('normal');
  const [notifications, setNotifications] = useState<{ msg: string; type: 'success' | 'error' | 'info' | 'warning'; time: string }[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [dataSource, setDataSource] = useState('/stm32/api');
  const logEndRef = useRef<HTMLDivElement>(null);

  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<any[]>([]);

  const addNotification = (msg: string, type: 'success' | 'error' | 'info' | 'warning') => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    setNotifications(prev => [{ msg, type, time }, ...prev.slice(0, 19)]);
  };

  // GNGGA Parser
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
      '0': '未定位', '1': '单点定位', '2': '差分定位', '4': 'RTK 固定解', '5': 'RTK 浮点解'
    };

    return {
      latitude: lat !== 0 ? lat : data.latitude,
      longitude: lon !== 0 ? lon : data.longitude,
      altitude: parts[9] ? parseFloat(parts[9]) : data.altitude,
      quality: qualityMap[qCode] || '未知',
      qualityCode: qCode,
      satellites: parseInt(parts[7] || '0'),
      raw: nmea
    };
  };

  // Initialize Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    const amapKey = import.meta.env.VITE_AMAP_KEY?.trim();
    const amapSecurityCode = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim();
    if (!amapKey || !amapSecurityCode) {
      addNotification('地图未配置，请设置 VITE_AMAP_KEY 和 VITE_AMAP_SECURITY_CODE', 'error');
      return;
    }

    (window as any)._AMapSecurityConfig = {
      securityJsCode: amapSecurityCode,
    };

    AMapLoader.load({
      key: amapKey,
      version: "2.0",
      plugins: ["AMap.Scale", "AMap.ToolBar", "AMap.ControlBar", "AMap.Polyline"],
    }).then((AMap) => {
      const map = new AMap.Map(mapContainerRef.current, {
        zoom: 18,
        center: [117.993469, 36.810429],
        theme: mapTheme === 'satellite' ? 'normal' : mapTheme,
        viewMode: '3D',
        pitch: 45,
      });

      map.addControl(new AMap.Scale());
      map.addControl(new AMap.ToolBar());

      const marker = new AMap.Marker({
        position: [117.993469, 36.810429],
        offset: new AMap.Pixel(-10, -10),
        content: `<div style="width:20px;height:20px;background:#3b82f6;border-radius:50%;border:3px solid white;box-shadow:0 0 12px rgba(59,130,246,0.6);"></div>`,
      });

      const polyline = new AMap.Polyline({
        path: [],
        strokeColor: "#3b82f6",
        strokeWeight: 4,
        strokeOpacity: 0.8,
        lineJoin: 'round',
        showDir: true
      });

      map.add(polyline);
      map.add(marker);

      mapRef.current = map;
      markerRef.current = marker;
      polylineRef.current = polyline;
    }).catch(e => {
      console.error('AMap load error:', e);
      addNotification('地图加载失败，请检查 API Key 或网络', 'error');
    });

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, [isOpen]);

  // Update Map Theme
  useEffect(() => {
    if (mapRef.current) {
      if (mapTheme === 'satellite') {
        const satelliteLayer = new (window as any).AMap.TileLayer.Satellite();
        mapRef.current.setLayers([satelliteLayer]);
      } else {
        mapRef.current.setLayers([]);
        mapRef.current.setTheme(mapTheme);
      }
    }
  }, [mapTheme]);

  // Update Marker and Trajectory
  useEffect(() => {
    if (mapRef.current && markerRef.current && polylineRef.current && data.longitude && data.latitude) {
      const pos = [data.longitude, data.latitude];
      markerRef.current.setPosition(pos);

      const lastPos = pathRef.current[pathRef.current.length - 1];
      if (!lastPos || (Math.abs(lastPos[0] - pos[0]) > 0.0000001 || Math.abs(lastPos[1] - pos[1]) > 0.0000001)) {
        pathRef.current = [...pathRef.current.slice(-999), pos];
        polylineRef.current.setPath(pathRef.current);
      }

      if (isLocked) mapRef.current.setCenter(pos);

      if (prevDataRef.current && prevDataRef.current.latitude && prevDataRef.current.longitude) {
        const deltaLat = data.latitude - prevDataRef.current.latitude;
        const deltaLon = data.longitude - prevDataRef.current.longitude;
        const deltaAlt = (data.altitude || 0) - (prevDataRef.current.altitude || 0);
        const dy = deltaLat * 111320;
        const dx = deltaLon * 111320 * Math.cos(data.latitude * Math.PI / 180);
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setDisplacementHistory(prev => [...prev.slice(-29), { time: now, x: dx, y: dy, z: deltaAlt }]);
      }
      prevDataRef.current = data;
    }
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
    const csv = 'longitude,latitude\n' + pathRef.current.map(p => `${p[0]},${p[1]}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trajectory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addNotification(`轨迹已导出 (${pathRef.current.length} 个点)`, 'success');
  };

  // Polling Data
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      try {
        const response = await fetch(`${dataSource}/data`);
        if (!response.ok) throw new Error('Network error');
        const json = await response.json();

        if (json.message) {
          const parsed = parseGngga(json.message);
          setData(parsed);
          setLogs(prev => [...prev.slice(-99), json.message]);
          setIsOnline(true);
        }
      } catch {
        setIsOnline(false);
      }
    };

    const interval = setInterval(fetchData, 1000);
    fetchData();
    return () => clearInterval(interval);
  }, [isOpen, dataSource]);

  // IMU Parser
  useEffect(() => {
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];

    if (lastLog.startsWith('ACC:')) {
      const parts = lastLog.replace('ACC:', '').replace('g', '').trim().split(/\s+/);
      if (parts.length >= 3) {
        setImu(prev => ({ ...prev, acc: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])] }));
      }
    } else if (lastLog.startsWith('GYRO:')) {
      const parts = lastLog.replace('GYRO:', '').replace('deg/s', '').trim().split(/\s+/);
      if (parts.length >= 3) {
        setImu(prev => ({ ...prev, gyro: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])] }));
      }
    }
  }, [logs]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const sendCmd = async () => {
    if (!command.trim()) return;
    const currentCmd = command.trim();
    setCommand('');

    try {
      const response = await fetch(`${dataSource}/send_cmd?cmd=${encodeURIComponent(currentCmd)}`);
      const result = await response.json();
      addNotification(
        `指令 [${currentCmd}] ${result.status === 'success' ? '已下发' : '失败'}: ${result.msg || ''}`,
        result.status === 'success' ? 'success' : 'error'
      );
    } catch {
      addNotification('指令发送失败，请检查网络', 'error');
    }
  };

  if (!isOpen) return null;

  const qualityColor = QUALITY_COLORS[data.qualityCode] || '#94a3b8';

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/30 backdrop-blur-sm"
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="relative w-screen h-screen bg-[#eef0f4] shadow-2xl overflow-hidden flex flex-col rounded-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-lg">
                <Cpu className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">北斗边坡高精度定位上位机</h2>
                <p className="text-[11px] text-gray-400">STM32 + UM980 + 4G 模块</p>
              </div>
              <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-gray-100 rounded-full">
                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} />
                <span className="text-xs font-medium text-gray-500">
                  {isOnline ? '设备在线' : '设备离线'}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                title="设置"
              >
                <Settings className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Settings Panel */}
          {showSettings && (
            <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-4">
                <label className="text-xs text-gray-500 font-medium">数据源地址:</label>
                <input
                  type="text"
                  value={dataSource}
                  onChange={(e) => setDataSource(e.target.value)}
                  className="flex-1 max-w-md px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:border-blue-500"
                  placeholder="/stm32/api"
                />
              </div>
            </div>
          )}

          {/* Main Layout */}
          <div className="flex-1 flex overflow-hidden p-3 gap-3">

            {/* Left Panel: Data Cards */}
            <div className="w-[280px] flex flex-col gap-3 overflow-y-auto shrink-0 pr-1">

              {/* GPS Data */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Satellite className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">UM980 定位数据</span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <DataCard
                    icon={<MapPin className="w-3 h-3" />}
                    label="经度"
                    value={`${data.longitude?.toFixed(7) || '--'}°`}
                    color="blue"
                    onClick={() => {
                      if (data.longitude) {
                        navigator.clipboard.writeText(data.longitude.toString());
                        addNotification('经度已复制', 'info');
                      }
                    }}
                  />
                  <DataCard
                    icon={<MapPin className="w-3 h-3" />}
                    label="纬度"
                    value={`${data.latitude?.toFixed(7) || '--'}°`}
                    color="cyan"
                    onClick={() => {
                      if (data.latitude) {
                        navigator.clipboard.writeText(data.latitude.toString());
                        addNotification('纬度已复制', 'info');
                      }
                    }}
                  />
                  <DataCard
                    icon={<Maximize2 className="w-3 h-3" />}
                    label="海拔"
                    value={`${data.altitude?.toFixed(2) || '--'} m`}
                    color="indigo"
                  />
                  <DataCard
                    icon={<Activity className="w-3 h-3" />}
                    label="定位状态"
                    value={data.quality}
                    color={data.qualityCode === '4' ? 'green' : 'gray'}
                    valueColor={qualityColor}
                  />
                  <DataCard
                    icon={<Satellite className="w-3 h-3" />}
                    label="卫星数"
                    value={`${data.satellites} 颗`}
                    color="amber"
                    className="col-span-2"
                  />
                </div>
              </div>

              {/* IMU Data */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-purple-500" />
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">IMU 惯性数据</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <ImuCard key={`acc-${axis}`} label={`加速度 ${axis}`} value={imu.acc[i]} unit="g" color="#8b5cf6" max={2} />
                  ))}
                  {(['X', 'Y', 'Z'] as const).map((axis, i) => (
                    <ImuCard key={`gyro-${axis}`} label={`角速度 ${axis}`} value={imu.gyro[i]} unit="°/s" color="#3b82f6" max={500} />
                  ))}
                </div>
              </div>

              {/* Command Input */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-3">
                  <Send className="w-4 h-4 text-blue-500" />
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">指令下发</span>
                </div>
                <textarea
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCmd(); } }}
                  placeholder="输入指令..."
                  className="w-full h-16 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm font-mono text-gray-700 placeholder:text-gray-400 focus:outline-none focus:border-blue-500 transition-colors resize-none mb-2"
                />
                <button
                  onClick={sendCmd}
                  disabled={!command.trim()}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-200 disabled:text-gray-400 text-white rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all"
                >
                  <Send className="w-3 h-3" />
                  发送指令
                </button>
              </div>

              {/* Notifications */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 shadow-sm flex-1 min-h-0 flex flex-col">
                <div className="px-4 py-2 border-b border-gray-100 flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">系统通知</span>
                  <button
                    onClick={() => setNotifications([])}
                    className="text-[10px] text-gray-400 hover:text-red-500 transition-colors"
                  >
                    清空
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  {notifications.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-4">暂无通知</p>
                  )}
                  {notifications.map((n, i) => (
                    <div
                      key={i}
                      className={`p-2 rounded-lg text-xs flex gap-2 ${
                        n.type === 'success' ? 'bg-green-50 text-green-700' :
                        n.type === 'error' ? 'bg-red-50 text-red-700' :
                        n.type === 'warning' ? 'bg-amber-50 text-amber-700' :
                        'bg-blue-50 text-blue-700'
                      }`}
                    >
                      <span className="text-[10px] text-gray-400 shrink-0">{n.time}</span>
                      <span>{n.msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Center: NMEA Monitor */}
            <div className="w-[280px] flex flex-col bg-gray-50 rounded-xl border border-gray-200 overflow-hidden shrink-0 shadow-sm">
              <div className="px-3 py-2 bg-gray-100 border-b border-gray-200 flex justify-between items-center">
                <div className="flex items-center gap-2 text-xs font-bold text-gray-600 uppercase tracking-wider">
                  <Terminal className="w-3 h-3" />
                  NMEA 原始数据
                </div>
                <button
                  onClick={() => setLogs([])}
                  className="p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[10px] space-y-0.5">
                {logs.length === 0 && (
                  <p className="text-gray-300 text-center py-8">等待数据...</p>
                )}
                {logs.map((log, i) => (
                  <div key={i} className="text-green-600 break-all leading-tight border-l-2 border-green-200 pl-2 py-0.5">
                    <span className="text-gray-400 mr-1">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                    {log}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Right: Map + Charts */}
            <div className="flex-1 flex flex-col gap-3 overflow-hidden">

              {/* Map */}
              <div className="flex-[3] bg-gray-50 rounded-xl border border-gray-200 overflow-hidden relative min-h-[300px] shadow-sm">
                <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
                  <div className="px-3 py-1.5 bg-white/80 border border-gray-200 rounded-lg backdrop-blur-sm flex items-center gap-2 shadow-sm">
                    <Maximize2 className="w-3 h-3 text-blue-500" />
                    <span className="text-xs font-bold text-gray-600">实时轨迹地图</span>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsLocked(!isLocked)}
                      className={`px-3 py-1.5 rounded-lg border backdrop-blur-sm text-xs font-medium transition-all flex items-center gap-2 shadow-sm ${
                        isLocked
                          ? 'bg-blue-50 border-blue-300 text-blue-600'
                          : 'bg-white/80 border-gray-200 text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-blue-500' : 'bg-gray-400'}`} />
                      {isLocked ? '锁定视角' : '自由视角'}
                    </button>

                    <button
                      onClick={clearPath}
                      className="px-3 py-1.5 bg-white/80 border border-gray-200 rounded-lg backdrop-blur-sm text-xs font-medium text-gray-500 hover:text-red-500 hover:border-red-300 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <Trash2 className="w-3 h-3" />
                      清除
                    </button>

                    <button
                      onClick={exportTrajectory}
                      className="px-3 py-1.5 bg-white/80 border border-gray-200 rounded-lg backdrop-blur-sm text-xs font-medium text-gray-500 hover:text-green-500 hover:border-green-300 transition-all flex items-center gap-2 shadow-sm"
                    >
                      <Download className="w-3 h-3" />
                      导出
                    </button>
                  </div>
                </div>

                <div className="absolute top-3 right-3 z-10 flex gap-1 p-1 bg-white/80 border border-gray-200 rounded-lg backdrop-blur-sm shadow-sm">
                  {(['normal', 'dark', 'satellite'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMapTheme(t)}
                      className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                        mapTheme === t
                          ? 'bg-blue-600 text-white'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {t === 'dark' ? '深色' : t === 'normal' ? '标准' : '卫星'}
                    </button>
                  ))}
                </div>

                <div ref={mapContainerRef} className="w-full h-full" />

                <div className="absolute bottom-3 left-3 z-10 px-3 py-1.5 bg-white/80 border border-gray-200 rounded-lg backdrop-blur-sm flex items-center gap-4 shadow-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[10px] text-gray-500">当前位置</span>
                  </div>
                  <div className="w-px h-3 bg-gray-300" />
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-blue-500" />
                    <span className="text-[10px] text-gray-500">轨迹</span>
                  </div>
                  <div className="w-px h-3 bg-gray-300" />
                  <span className="text-[10px] text-gray-400">{pathRef.current.length} 点</span>
                </div>
              </div>

              {/* Displacement Charts */}
              <div className="flex-[2] bg-gray-50 rounded-xl border border-gray-200 p-4 flex flex-col gap-3 min-h-[250px] shadow-sm">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-500" />
                    <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">XYZ 三轴位移</span>
                  </div>
                  <span className="text-[10px] text-gray-400">每秒采样</span>
                </div>

                <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1">
                  {[
                    { key: 'x', label: 'X (东/西)', color: '#3b82f6' },
                    { key: 'y', label: 'Y (南/北)', color: '#10b981' },
                    { key: 'z', label: 'Z (高度)', color: '#f59e0b' },
                  ].map(({ key, label, color }) => (
                    <div key={key} className="bg-gray-100 rounded-lg border border-gray-200 p-2 h-[80px] shrink-0">
                      <div className="flex items-center justify-between mb-1 px-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ background: color }} />
                          <span className="text-[10px] text-gray-500 font-medium">{label}</span>
                        </div>
                        <span className="text-[10px] font-mono" style={{ color }}>
                          {displacementHistory.length > 0
                            ? (displacementHistory[displacementHistory.length - 1] as any)[key].toFixed(3)
                            : '0.000'} m
                        </span>
                      </div>
                      <div className="h-[50px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={displacementHistory}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                            <XAxis dataKey="time" hide />
                            <YAxis stroke="#9ca3af" fontSize={8} tickLine={false} axisLine={false} width={25} />
                            <Tooltip
                              contentStyle={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '11px', padding: '8px' }}
                            />
                            <Line type="monotone" dataKey={key} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
                <Radio className="w-3 h-3" />
                NMEA-0183
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
                <Activity className="w-3 h-3" />
                115200 baud
              </div>
              <div className="flex items-center gap-2 text-[11px] font-mono text-gray-400">
                <Satellite className="w-3 h-3" />
                {data.satellites} 颗卫星
              </div>
            </div>
            <div className="text-[11px] font-mono text-gray-400">
              {dataSource}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};

// ── 子组件 ──────────────────────────────────────────

function DataCard({ icon, label, value, color, valueColor, onClick, className }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  valueColor?: string;
  onClick?: () => void;
  className?: string;
}) {
  const colorMap: Record<string, { bg: string; border: string; text: string }> = {
    blue: { bg: 'bg-blue-50', border: 'border-blue-100', text: 'text-blue-600' },
    cyan: { bg: 'bg-cyan-50', border: 'border-cyan-100', text: 'text-cyan-600' },
    indigo: { bg: 'bg-indigo-50', border: 'border-indigo-100', text: 'text-indigo-600' },
    green: { bg: 'bg-green-50', border: 'border-green-100', text: 'text-green-600' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-100', text: 'text-amber-600' },
    gray: { bg: 'bg-gray-50', border: 'border-gray-100', text: 'text-gray-600' },
  };
  const c = colorMap[color] || colorMap.gray;

  return (
    <div
      onClick={onClick}
      className={`${c.bg} ${c.border} border rounded-lg p-2 flex flex-col gap-1 ${onClick ? 'cursor-pointer hover:border-blue-300' : ''} transition-all ${className || ''}`}
    >
      <div className="flex items-center gap-1">
        <span className={c.text}>{icon}</span>
        <span className="text-[10px] text-gray-400 font-medium uppercase">{label}</span>
      </div>
      <span className="text-sm font-mono font-bold" style={{ color: valueColor || undefined }}>
        {value}
      </span>
    </div>
  );
}

function ImuCard({ label, value, unit, color, max }: {
  label: string;
  value: number;
  unit: string;
  color: string;
  max: number;
}) {
  const pct = Math.min(Math.abs(value) / max * 100, 100);
  return (
    <div className="bg-gray-100 rounded-lg border border-gray-200 p-2">
      <span className="text-[9px] text-gray-400 font-medium uppercase">{label}</span>
      <div className="text-sm font-mono font-bold" style={{ color }}>{value.toFixed(3)} <span className="text-[10px] text-gray-400">{unit}</span></div>
      <div className="h-1 bg-gray-200 rounded-full overflow-hidden mt-1">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
