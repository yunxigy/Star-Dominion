import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cpu, Radio, Send, Terminal, Activity, Satellite, MapPin, AlertCircle, CheckCircle2, Trash2, Maximize2, BarChart3 } from 'lucide-react';
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

export const Stm32ConsoleModal: React.FC<Stm32ConsoleModalProps> = ({ isOpen, onClose }) => {
  const [data, setData] = useState<GnggaData>({
    latitude: null,
    longitude: null,
    altitude: null,
    quality: '未知',
    qualityCode: '0',
    satellites: 0,
    raw: ''
  });
  const [imu, setImu] = useState<ImuData>({
    acc: [0, 0, 0],
    gyro: [0, 0, 0]
  });
  const [displacementHistory, setDisplacementHistory] = useState<{ time: string; x: number; y: number; z: number }[]>([]);
  const prevDataRef = useRef<GnggaData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [isOnline, setIsOnline] = useState(false);
  const [isLocked, setIsLocked] = useState(true);
  const [mapTheme, setMapTheme] = useState<'dark' | 'normal' | 'satellite'>('dark');
  const [notifications, setNotifications] = useState<{ msg: string; type: 'success' | 'error' | 'info' | 'warning' }[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  
  // Map refs
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const polylineRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<any[]>([]);

  // GNGGA Parser
  const parseGngga = (nmea: string): GnggaData => {
    const parts = nmea.split(',');
    if (!parts[0] || !parts[0].includes('GGA')) {
      return { ...data, raw: nmea };
    }

    // Index 2: Latitude ddmm.mmmm
    let lat = 0;
    if (parts[2] && parts[2].length > 4) {
      const degrees = parseFloat(parts[2].substring(0, 2));
      const minutes = parseFloat(parts[2].substring(2));
      lat = degrees + minutes / 60;
      if (parts[3] === 'S') lat = -lat;
    }

    // Index 4: Longitude dddmm.mmmm
    let lon = 0;
    if (parts[4] && parts[4].length > 5) {
      const degrees = parseFloat(parts[4].substring(0, 3));
      const minutes = parseFloat(parts[4].substring(3));
      lon = degrees + minutes / 60;
      if (parts[5] === 'W') lon = -lon;
    }

    // Index 6: Quality
    const qCode = parts[6] || '0';
    const qualityMap: Record<string, string> = {
      '0': '未定位',
      '1': '单点定位',
      '2': '差分定位',
      '4': 'RTK 固定解',
      '5': 'RTK 浮点解'
    };

    // Index 7: Satellites
    const sats = parseInt(parts[7] || '0');

    // Index 9: Altitude
    const alt = parts[9] ? parseFloat(parts[9]) : null;

    return {
      latitude: lat !== 0 ? lat : data.latitude,
      longitude: lon !== 0 ? lon : data.longitude,
      altitude: alt !== null ? alt : data.altitude,
      quality: qualityMap[qCode] || '未知',
      qualityCode: qCode,
      satellites: sats,
      raw: nmea
    };
  };

  // Initialize Map
  useEffect(() => {
    if (!isOpen || !mapContainerRef.current) return;

    // AMap Security Config (Required for v2.0)
    (window as any)._AMapSecurityConfig = {
      securityJsCode: "7427090a19ead0f132fd6dedad4a2d6a",
    };

    AMapLoader.load({
      key: "80d0f2e44986109a8c37f67194590127",
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
        content: `<div class="w-5 h-5 bg-blue-500 rounded-full border-2 border-white shadow-[0_0_10px_rgba(59,130,246,0.8)] animate-pulse"></div>`,
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
      setNotifications(prev => [{ msg: '地图加载失败，请检查 API Key 或网络', type: 'error' }, ...prev.slice(0, 4)]);
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
      
      // Update path
      const lastPos = pathRef.current[pathRef.current.length - 1];
      if (!lastPos || (Math.abs(lastPos[0] - pos[0]) > 0.0000001 || Math.abs(lastPos[1] - pos[1]) > 0.0000001)) {
        pathRef.current = [...pathRef.current.slice(-999), pos]; // Keep last 1000 points
        polylineRef.current.setPath(pathRef.current);
      }
      
      if (isLocked) {
        mapRef.current.setCenter(pos);
      }

      // Calculate Displacement
      if (prevDataRef.current && prevDataRef.current.latitude && prevDataRef.current.longitude) {
        const deltaLat = data.latitude - prevDataRef.current.latitude;
        const deltaLon = data.longitude - prevDataRef.current.longitude;
        const deltaAlt = (data.altitude || 0) - (prevDataRef.current.altitude || 0);

        // Convert to meters (approximate)
        const dy = deltaLat * 111320;
        const dx = deltaLon * 111320 * Math.cos(data.latitude * Math.PI / 180);
        const dz = deltaAlt;

        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setDisplacementHistory(prev => [...prev.slice(-29), { time: now, x: dx, y: dy, z: dz }]);
      }
      prevDataRef.current = data;
    }
  }, [data.longitude, data.latitude, data.altitude, isLocked]);

  const clearPath = () => {
    pathRef.current = [];
    if (polylineRef.current) {
      polylineRef.current.setPath([]);
    }
    setNotifications(prev => [{ msg: '轨迹已清除', type: 'info' }, ...prev.slice(0, 4)]);
  };

  // Polling Data
  useEffect(() => {
    if (!isOpen) return;

    const fetchData = async () => {
      try {
        const response = await fetch('http://117.72.222.38:5005/data');
        if (!response.ok) throw new Error('Network response was not ok');
        const json = await response.json();
        
        if (json.message) {
          const parsed = parseGngga(json.message);
          setData(parsed);
          setLogs(prev => [...prev.slice(-99), json.message]); // Keep last 100 logs
          setIsOnline(true);
        }
      } catch (error) {
        console.error('Fetch error:', error);
        setIsOnline(false);
        
        if (window.location.protocol === 'https:') {
          setNotifications(prev => {
            if (prev.some(n => n.msg.includes('HTTPS'))) return prev;
            return [{ msg: '检测到 HTTPS 环境下访问 HTTP 后端，请允许不安全内容加载或使用 HTTP 访问本站', type: 'warning' }, ...prev.slice(0, 4)];
          });
        }
      }
    };

    const interval = setInterval(fetchData, 1000);
    fetchData();

    return () => clearInterval(interval);
  }, [isOpen]);

  // IMU Parser
  useEffect(() => {
    if (logs.length === 0) return;
    const lastLog = logs[logs.length - 1];
    
    if (lastLog.startsWith('ACC:')) {
      const parts = lastLog.replace('ACC:', '').replace('g', '').trim().split(/\s+/);
      if (parts.length >= 3) {
        setImu(prev => ({
          ...prev,
          acc: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
        }));
      }
    } else if (lastLog.startsWith('GYRO:')) {
      const parts = lastLog.replace('GYRO:', '').replace('deg/s', '').trim().split(/\s+/);
      if (parts.length >= 3) {
        setImu(prev => ({
          ...prev,
          gyro: [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])]
        }));
      }
    }
  }, [logs]);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Send Command
  const sendCmd = async () => {
    if (!command.trim()) return;
    
    const currentCmd = command.trim();
    setCommand('');
    
    try {
      const response = await fetch(`http://117.72.222.38:5005/send_cmd?cmd=${encodeURIComponent(currentCmd)}`);
      const result = await response.json();
      
      const newNotif = {
        msg: `指令 [${currentCmd}] 发送${result.status === 'success' ? '成功' : '失败'}: ${result.msg || ''}`,
        type: result.status === 'success' ? 'success' as const : 'error' as const
      };
      
      setNotifications(prev => [newNotif, ...prev.slice(0, 4)]);
    } catch (error) {
      setNotifications(prev => [{ msg: '指令发送异常，请检查网络', type: 'error' }, ...prev.slice(0, 4)]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendCmd();
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-screen h-screen bg-[#0a0f1e] shadow-2xl overflow-hidden flex flex-col"
        >
          {/* Top Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-[#111827] border-b border-slate-800 shrink-0">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-500/10 rounded-lg">
                <Cpu className="w-6 h-6 text-blue-400" />
              </div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
                STM32 北斗边坡高精度定位上位机
              </h2>
              <div className="flex items-center gap-2 ml-4 px-3 py-1 bg-slate-900/50 rounded-full border border-slate-800">
                <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-xs font-mono text-slate-400 uppercase tracking-widest">
                  {isOnline ? '设备在线' : '设备离线'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Main Layout */}
          <div className="flex-1 flex overflow-hidden p-4 gap-4">
            
            {/* Left Column: Dashboard + Controls */}
            <div className="w-[320px] flex flex-col gap-4 overflow-hidden shrink-0">
              
              {/* UM980 Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Satellite className="w-4 h-4 text-blue-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">UM980 数据</span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 shrink-0">
                  <div 
                    onClick={() => {
                      if (data.longitude) {
                        navigator.clipboard.writeText(data.longitude.toString());
                        setNotifications(prev => [{ msg: '经度已复制', type: 'info' }, ...prev.slice(0, 4)]);
                      }
                    }}
                    className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 group hover:border-blue-500/40 transition-all cursor-pointer relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-blue-400" />
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">经度</span>
                      </div>
                    </div>
                    <div className="text-sm font-mono text-slate-100 truncate relative z-10 font-bold">
                      {data.longitude?.toFixed(7) || '0.0000000'}°
                    </div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-blue-500/5 rotate-45 translate-x-4 translate-y-4 group-hover:bg-blue-500/10 transition-colors" />
                  </div>
                  
                  <div 
                    onClick={() => {
                      if (data.latitude) {
                        navigator.clipboard.writeText(data.latitude.toString());
                        setNotifications(prev => [{ msg: '纬度已复制', type: 'info' }, ...prev.slice(0, 4)]);
                      }
                    }}
                    className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 group hover:border-blue-500/40 transition-all cursor-pointer relative overflow-hidden"
                  >
                    <div className="flex items-center justify-between relative z-10">
                      <div className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-cyan-400" />
                        <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">纬度</span>
                      </div>
                    </div>
                    <div className="text-sm font-mono text-slate-100 truncate relative z-10 font-bold">
                      {data.latitude?.toFixed(7) || '0.0000000'}°
                    </div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-cyan-500/5 rotate-45 translate-x-4 translate-y-4 group-hover:bg-cyan-500/10 transition-colors" />
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 group hover:border-blue-500/40 transition-all relative overflow-hidden">
                    <div className="flex items-center gap-1 relative z-10">
                      <Maximize2 className="w-3 h-3 text-indigo-400" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">高度</span>
                    </div>
                    <div className="text-sm font-mono text-slate-100 relative z-10 font-bold">
                      {data.altitude?.toFixed(2) || '0.00'} m
                    </div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-indigo-500/5 rotate-45 translate-x-4 translate-y-4 group-hover:bg-indigo-500/10 transition-colors" />
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 group hover:border-blue-500/40 transition-all relative overflow-hidden">
                    <div className="flex items-center gap-1 relative z-10">
                      <Activity className={`w-3 h-3 ${data.qualityCode === '4' ? 'text-emerald-400' : 'text-slate-400'}`} />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">定位状态</span>
                    </div>
                    <div className={`text-xs font-bold truncate relative z-10 ${data.qualityCode === '4' ? 'text-emerald-400' : 'text-slate-300'}`}>
                      {data.quality}
                    </div>
                    <div className={`absolute bottom-0 right-0 w-8 h-8 rotate-45 translate-x-4 translate-y-4 transition-colors ${data.qualityCode === '4' ? 'bg-emerald-500/5 group-hover:bg-emerald-500/10' : 'bg-slate-500/5'}`} />
                  </div>

                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 group hover:border-blue-500/40 transition-all relative overflow-hidden col-span-2">
                    <div className="flex items-center gap-1 relative z-10">
                      <Satellite className="w-3 h-3 text-amber-400" />
                      <span className="text-[9px] text-slate-500 font-bold uppercase tracking-tighter">卫星数量</span>
                    </div>
                    <div className="text-sm font-mono text-slate-100 relative z-10 font-bold">
                      {data.satellites.toString().padStart(2, '0')} 颗
                    </div>
                    <div className="absolute bottom-0 right-0 w-8 h-8 bg-amber-500/5 rotate-45 translate-x-4 translate-y-4 group-hover:bg-amber-500/10 transition-colors" />
                  </div>
                </div>
              </div>

              {/* IMU Section */}
              <div className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Activity className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">IMU 数据</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {/* Acceleration X */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">加速度 X (g)</span>
                    <div className="text-sm font-mono text-purple-400 font-bold">{imu.acc[0].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-purple-500" style={{ width: `${Math.min(Math.abs(imu.acc[0]) * 100, 100)}%` }} />
                    </div>
                  </div>
                  {/* Acceleration Y */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">加速度 Y (g)</span>
                    <div className="text-sm font-mono text-purple-400 font-bold">{imu.acc[1].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-purple-500" style={{ width: `${Math.min(Math.abs(imu.acc[1]) * 100, 100)}%` }} />
                    </div>
                  </div>
                  {/* Acceleration Z */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">加速度 Z (g)</span>
                    <div className="text-sm font-mono text-purple-400 font-bold">{imu.acc[2].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-purple-500" style={{ width: `${Math.min(Math.abs(imu.acc[2]) * 100, 100)}%` }} />
                    </div>
                  </div>
                  {/* Gyroscope X */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">角速度 X (deg/s)</span>
                    <div className="text-sm font-mono text-blue-400 font-bold">{imu.gyro[0].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.min(Math.abs(imu.gyro[0]) / 2, 100)}%` }} />
                    </div>
                  </div>
                  {/* Gyroscope Y */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">角速度 Y (deg/s)</span>
                    <div className="text-sm font-mono text-blue-400 font-bold">{imu.gyro[1].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.min(Math.abs(imu.gyro[1]) / 2, 100)}%` }} />
                    </div>
                  </div>
                  {/* Gyroscope Z */}
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/60 flex flex-col gap-1 relative overflow-hidden">
                    <span className="text-[8px] text-slate-500 font-bold uppercase tracking-tighter">角速度 Z (deg/s)</span>
                    <div className="text-sm font-mono text-blue-400 font-bold">{imu.gyro[2].toFixed(3)}</div>
                    <div className="h-0.5 bg-slate-800 rounded-full overflow-hidden mt-1">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.min(Math.abs(imu.gyro[2]) / 2, 100)}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Command Input */}
              <div className="flex flex-col bg-[#111827]/50 rounded-lg border border-slate-800 overflow-hidden shrink-0">
                <div className="px-3 py-2 bg-slate-900/80 border-b border-slate-800">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-300 uppercase tracking-widest">
                    <Send className="w-3 h-3 text-blue-400" />
                    指令下发
                  </div>
                </div>
                <div className="p-3 space-y-3">
                  <textarea
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="请输入指令..."
                    className="w-full h-20 bg-slate-950 border border-slate-800 rounded p-2 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500/50 transition-colors resize-none"
                  />
                  <button
                    onClick={sendCmd}
                    disabled={!command.trim()}
                    className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
                  >
                    发送 (Enter)
                  </button>
                </div>
              </div>

              {/* Notifications */}
              <div className="flex-1 flex flex-col bg-[#111827]/30 rounded-lg border border-slate-800/50 overflow-hidden">
                <div className="px-3 py-2 bg-slate-900/40 border-b border-slate-800/50">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">系统通知</div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-800">
                  {notifications.map((n, i) => (
                    <motion.div
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={i}
                      className={`p-2 rounded border text-[10px] flex gap-2 ${
                        n.type === 'success' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-200' :
                        n.type === 'error' ? 'bg-red-500/5 border-red-500/20 text-red-200' :
                        n.type === 'warning' ? 'bg-amber-500/5 border-amber-500/20 text-amber-200' :
                        'bg-blue-500/5 border-blue-500/20 text-blue-200'
                      }`}
                    >
                      {n.type === 'success' ? <CheckCircle2 className="w-3 h-3 shrink-0" /> : 
                       n.type === 'warning' ? <AlertCircle className="w-3 h-3 shrink-0 text-amber-400" /> :
                       <AlertCircle className="w-3 h-3 shrink-0" />}
                      <div className="leading-tight">{n.msg}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            {/* Center Column: Terminal Monitor */}
            <div className="w-[300px] flex flex-col bg-black/40 rounded border border-slate-800/80 overflow-hidden shrink-0">
              <div className="px-3 py-1.5 bg-slate-900/60 border-b border-slate-800 flex justify-between items-center">
                <div className="flex items-center gap-2 text-[9px] font-bold text-slate-400 uppercase tracking-widest">
                  <Terminal className="w-2.5 h-2.5" />
                  NMEA 监视器
                </div>
                <button 
                  onClick={() => setLogs([])}
                  className="p-1 hover:bg-slate-800 rounded text-slate-500 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-2 font-mono text-[9px] space-y-0.5 scrollbar-thin scrollbar-thumb-slate-800">
                {logs.map((log, i) => (
                  <div key={i} className="text-emerald-500/70 break-all leading-tight border-l border-emerald-500/10 pl-2">
                    <span className="text-slate-600 mr-1 opacity-50">[{new Date().toLocaleTimeString([], { hour12: false })}]</span>
                    {log}
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>

            {/* Right Column: Map & Chart */}
            <div className="flex-1 flex flex-col gap-4 overflow-hidden">
              {/* Map Container */}
              <div className="flex-[3] bg-slate-900 rounded-xl border border-slate-800 overflow-hidden relative min-h-[400px]">
                <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
                  <div className="px-3 py-1.5 bg-slate-950/80 border border-slate-800 rounded-lg backdrop-blur-md flex items-center gap-2">
                    <Maximize2 className="w-3 h-3 text-blue-400" />
                    <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">实时轨迹地图</span>
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsLocked(!isLocked)}
                      className={`px-3 py-1.5 rounded-lg border backdrop-blur-md text-[10px] font-bold transition-all flex items-center gap-2 ${
                        isLocked 
                          ? 'bg-blue-500/20 border-blue-500/50 text-blue-400' 
                          : 'bg-slate-950/80 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className={`w-1.5 h-1.5 rounded-full ${isLocked ? 'bg-blue-400 shadow-[0_0_5px_rgba(96,165,250,0.8)]' : 'bg-slate-600'}`} />
                      {isLocked ? '视角锁定' : '自由视角'}
                    </button>
                    
                    <button
                      onClick={clearPath}
                      className="px-3 py-1.5 bg-slate-950/80 border border-slate-800 rounded-lg backdrop-blur-md text-[10px] font-bold text-slate-400 hover:text-red-400 hover:border-red-500/30 transition-all flex items-center gap-2"
                    >
                      <Trash2 className="w-3 h-3" />
                      清除轨迹
                    </button>
                  </div>
                </div>

                {/* Map Theme Toggle */}
                <div className="absolute top-4 right-4 z-10 flex gap-1 p-1 bg-slate-950/80 border border-slate-800 rounded-lg backdrop-blur-md">
                  {(['dark', 'normal', 'satellite'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMapTheme(t)}
                      className={`px-2 py-1 rounded text-[9px] font-bold uppercase transition-all ${
                        mapTheme === t 
                          ? 'bg-blue-600 text-white' 
                          : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {t === 'dark' ? '深色' : t === 'normal' ? '标准' : '卫星'}
                    </button>
                  ))}
                </div>
                
                <div ref={mapContainerRef} className="w-full h-full" />
                
                {/* Map Bottom Info Overlay */}
                <div className="absolute bottom-4 left-4 z-10 px-3 py-1.5 bg-slate-950/80 border border-slate-800 rounded-lg backdrop-blur-md flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-[10px] text-slate-400">当前位置</span>
                  </div>
                  <div className="w-px h-3 bg-slate-800" />
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-0.5 bg-blue-500" />
                    <span className="text-[10px] text-slate-400">历史轨迹</span>
                  </div>
                </div>
              </div>

              {/* Displacement Chart Container */}
              <div className="flex-[2] bg-[#111827]/50 rounded-xl border border-slate-800 p-4 flex flex-col gap-3 min-h-[350px]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">XYZ 三轴位移变化 (每秒)</span>
                  </div>
                </div>
                
                <div className="flex-1 flex flex-col gap-2 overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-slate-800">
                  {/* X Axis Chart */}
                  <div className="bg-slate-950/40 rounded-lg border border-slate-800/50 p-2 h-[90px] shrink-0">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        <span className="text-[9px] text-slate-400 font-bold uppercase">X (东/西) 位移</span>
                      </div>
                      <span className="text-[9px] font-mono text-blue-400">
                        {displacementHistory.length > 0 ? displacementHistory[displacementHistory.length - 1].x.toFixed(3) : '0.000'} m
                      </span>
                    </div>
                    <div className="h-[60px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={displacementHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                          <XAxis dataKey="time" hide />
                          <YAxis stroke="#475569" fontSize={8} tickLine={false} axisLine={false} width={25} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '8px', padding: '4px' }}
                            itemStyle={{ padding: '0' }}
                          />
                          <Line type="monotone" dataKey="x" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Y Axis Chart */}
                  <div className="bg-slate-950/40 rounded-lg border border-slate-800/50 p-2 h-[90px] shrink-0">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span className="text-[9px] text-slate-400 font-bold uppercase">Y (南/北) 位移</span>
                      </div>
                      <span className="text-[9px] font-mono text-emerald-400">
                        {displacementHistory.length > 0 ? displacementHistory[displacementHistory.length - 1].y.toFixed(3) : '0.000'} m
                      </span>
                    </div>
                    <div className="h-[60px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={displacementHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                          <XAxis dataKey="time" hide />
                          <YAxis stroke="#475569" fontSize={8} tickLine={false} axisLine={false} width={25} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '8px', padding: '4px' }}
                            itemStyle={{ padding: '0' }}
                          />
                          <Line type="monotone" dataKey="y" stroke="#10b981" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* Z Axis Chart */}
                  <div className="bg-slate-950/40 rounded-lg border border-slate-800/50 p-2 h-[90px] shrink-0">
                    <div className="flex items-center justify-between mb-1 px-1">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                        <span className="text-[9px] text-slate-400 font-bold uppercase">Z (高度) 位移</span>
                      </div>
                      <span className="text-[9px] font-mono text-amber-400">
                        {displacementHistory.length > 0 ? displacementHistory[displacementHistory.length - 1].z.toFixed(3) : '0.000'} m
                      </span>
                    </div>
                    <div className="h-[60px] w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={displacementHistory}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                          <XAxis dataKey="time" stroke="#475569" fontSize={8} tickLine={false} axisLine={false} />
                          <YAxis stroke="#475569" fontSize={8} tickLine={false} axisLine={false} width={25} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: '4px', fontSize: '8px', padding: '4px' }}
                            itemStyle={{ padding: '0' }}
                          />
                          <Line type="monotone" dataKey="z" stroke="#f59e0b" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Bar */}
          <div className="px-6 py-2 bg-[#0a0f1e] border-t border-slate-800 flex justify-between items-center shrink-0">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                <Radio className="w-3 h-3" />
                传输协议: NMEA-0183
              </div>
              <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500">
                <Activity className="w-3 h-3" />
                波特率: 115200
              </div>
            </div>
            <div className="text-[10px] font-mono text-slate-600">
              © 2026 星盟科技 STAR ALLIANCE TECH
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
