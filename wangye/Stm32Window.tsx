import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, Radio, Satellite } from 'lucide-react';
import { CommandPanel } from './stm32/CommandPanel';
import { LeftTelemetryDock } from './stm32/LeftTelemetryDock';
import { MapSurface } from './stm32/MapSurface';
import { NmeaPanel } from './stm32/NmeaPanel';
import { NotificationPanel } from './stm32/NotificationPanel';
import { EMPTY_ALARM_SETTINGS, normalizeAlarmSettings } from './stm32/alarmSettings';
import type { AlarmSettings, DeviceMessage, DeviceRecord, DisplacementPoint, LogEntry, MapTheme, NotificationItem } from './stm32/types';
import {
  formatLogTime,
  isValidMessage,
  normalizeDevice,
  stripDevicePrefix,
} from './stm32/telemetry';

export default function Stm32Window() {
  const [devices, setDevices] = useState<Record<string, DeviceRecord>>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [logsByDevice, setLogsByDevice] = useState<Record<string, LogEntry[]>>({});
  const [displacementHistoryByDevice, setDisplacementHistoryByDevice] = useState<Record<string, DisplacementPoint[]>>({});
  const [isLocked, setIsLocked] = useState(true);
  const [mapTheme, setMapTheme] = useState<MapTheme>('dark');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [alarmSettings, setAlarmSettings] = useState<AlarmSettings>(EMPTY_ALARM_SETTINGS);
  const [alarmSettingsSaving, setAlarmSettingsSaving] = useState(false);
  const [dataSource] = useState(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    const basePath = path.includes('/stm32') ? '/stm32' : '';
    return basePath ? `${basePath}/api` : '/api';
  });

  const lastMessageSeqRef = useRef<Record<string, number>>({});
  const previousOnlineByDeviceRef = useRef<Record<string, boolean>>({});
  const alarmSignatureByDeviceRef = useRef<Record<string, string>>({});
  const alarmSettingsRevisionRef = useRef(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sortedDevices = Object.values(devices).sort((a, b) => Number(a.device_id) - Number(b.device_id));
  const selectedDevice = selectedDeviceId ? devices[selectedDeviceId] || null : null;
  const selectedLogs = selectedDeviceId ? logsByDevice[selectedDeviceId] || [] : [];
  const selectedDisplacement = selectedDeviceId ? displacementHistoryByDevice[selectedDeviceId] || [] : [];
  const onlineDeviceCount = sortedDevices.filter((device) => device.online).length;

  const addNotification = useCallback((msg: string, type: NotificationItem['type']) => {
    setNotifications((previous) => [{ msg, type, time: formatLogTime(Date.now()) }, ...previous.slice(0, 49)]);
  }, []);

  const acceptAlarmSettings = useCallback((value: unknown, revisionValue: unknown) => {
    const parsedRevision = Number(revisionValue);
    const revision = Number.isFinite(parsedRevision) && parsedRevision >= 0 ? parsedRevision : 0;
    if (revision < alarmSettingsRevisionRef.current) return;
    alarmSettingsRevisionRef.current = revision;
    setAlarmSettings(normalizeAlarmSettings(value));
  }, []);

  useEffect(() => {
    let alive = true;
    const loadAlarmSettings = async () => {
      try {
        const response = await fetch(`${dataSource}/alarm-settings`);
        if (!response.ok) throw new Error('alarm settings request failed');
        const payload = await response.json();
        if (alive) acceptAlarmSettings(payload?.settings, payload?.revision ?? payload?.updated_at_ms);
      } catch {
        if (alive) addNotification('云端预警设置加载失败，将使用未启用状态', 'warning');
      }
    };
    void loadAlarmSettings();
    return () => { alive = false; };
  }, [acceptAlarmSettings, addNotification, dataSource]);

  const saveAlarmSettings = useCallback(async (nextSettings: AlarmSettings): Promise<boolean> => {
    setAlarmSettingsSaving(true);
    try {
      const response = await fetch(`${dataSource}/alarm-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.message || 'alarm settings update failed');
      acceptAlarmSettings(payload?.settings ?? nextSettings, payload?.revision ?? payload?.updated_at_ms);
      addNotification('云端预警标准已保存，所有设备立即生效', 'success');
      return true;
    } catch {
      addNotification('云端预警标准保存失败，请检查网络或输入值', 'error');
      return false;
    } finally {
      setAlarmSettingsSaving(false);
    }
  }, [acceptAlarmSettings, addNotification, dataSource]);

  const clearPath = useCallback((deviceId: string) => {
    addNotification(`[设备 ${deviceId}] 地图轨迹已清除`, 'info');
  }, [addNotification]);

  const exportTrajectory = useCallback((deviceId: string, path: [number, number][]) => {
    const csv = `longitude,latitude\n${path.map((point) => `${point[0]},${point[1]}`).join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trajectory_${deviceId}_${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    addNotification(`[设备 ${deviceId}] 轨迹已导出 (${path.length} 个点)`, 'success');
  }, [addNotification]);

  useEffect(() => {
    let alive = true;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;

    const handleDeviceMessage = (device: DeviceRecord, item: DeviceMessage) => {
      const message = stripDevicePrefix(device.device_id, item.message);
      if (!message || !isValidMessage(message)) return;

      const timestamp = item.server_timestamp || device.server_timestamp || Date.now();
      const alarm = device.alarm;
      if (!alarm || ['NORMAL', 'GREEN'].includes(alarm.level)) {
        delete alarmSignatureByDeviceRef.current[device.device_id];
      } else {
        const conditionSignature = (alarm.conditions || [])
          .map((condition) => `${condition.metric}:${condition.absolute_value}:${condition.threshold}`)
          .join(',');
        const signature = [device.device_id, alarm.source, alarm.metric, alarm.absolute_value, alarm.threshold, conditionSignature].join('|');
        if (alarmSignatureByDeviceRef.current[device.device_id] !== signature) {
          alarmSignatureByDeviceRef.current[device.device_id] = signature;
          addNotification(`[设备 ${device.device_id}] ${alarm.message || alarm.label || '云端阈值预警'}`, alarm.level === 'RED' ? 'error' : 'warning');
        }
      }

      const logText = `[设备 ${device.device_id}] ${message}`;
      const logEntry: LogEntry = { deviceId: device.device_id, seq: item.seq, text: logText, timestamp };
      setLogsByDevice((current) => {
        const existing = current[device.device_id] || [];
        if (existing.some((entry) => entry.seq === item.seq)) return current;
        return { ...current, [device.device_id]: [...existing.slice(-199), logEntry] };
      });
    };

    const handlePayload = (json: any) => {
      if (json?.alarm_settings && typeof json.alarm_settings === 'object') {
        acceptAlarmSettings(json.alarm_settings, json.alarm_settings_revision ?? json.alarm_settings_updated_at_ms);
      }
      const hasDevicesSnapshot = Boolean(json && json.devices && typeof json.devices === 'object' && !Array.isArray(json.devices));
      const entries: [string, unknown][] = hasDevicesSnapshot
        ? Object.entries(json.devices)
        : json && json.device_id !== undefined && json.device_id !== null
          ? [[String(json.device_id), json]]
          : [];
      const normalizedDevices = entries.reduce<Record<string, DeviceRecord>>((result, [id, value]) => {
        const device = normalizeDevice(id, value);
        result[device.device_id] = device;
        if (!device.alarm || ['NORMAL', 'GREEN'].includes(device.alarm.level)) {
          delete alarmSignatureByDeviceRef.current[device.device_id];
        }
        return result;
      }, {});

      if (hasDevicesSnapshot) setDevices(normalizedDevices);
      else if (entries.length > 0) setDevices((current) => ({ ...current, ...normalizedDevices }));
      setDisplacementHistoryByDevice((current) => {
        const next = hasDevicesSnapshot ? {} as Record<string, DisplacementPoint[]> : { ...current };
        Object.values(normalizedDevices).forEach((device) => { next[device.device_id] = device.gnss?.history || []; });
        return next;
      });
      if (entries.length === 0) return;

      Object.values(normalizedDevices).forEach((device) => {
        const snapshotMessages = device.messages.length > 0
          ? device.messages
          : device.message && device.message !== 'no data'
            ? [{ seq: device.message_seq || 1, message: device.message, device_id: device.device_id, server_timestamp: device.server_timestamp }]
            : [];
        const previousSeq = lastMessageSeqRef.current[device.device_id] || 0;
        let highestSeq = previousSeq;
        [...snapshotMessages]
          .sort((a, b) => a.seq - b.seq)
          .forEach((item) => {
            if (item.seq <= previousSeq) return;
            highestSeq = Math.max(highestSeq, item.seq);
            handleDeviceMessage(device, item);
          });
        lastMessageSeqRef.current[device.device_id] = highestSeq;
      });
    };

    const buildWsUrl = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      return `${protocol}://${window.location.host}${dataSource}/ws`;
    };

    const fetchFallback = async () => {
      try {
        const response = await fetch(`${dataSource}/data`);
        if (!response.ok) throw new Error('Network error');
        handlePayload(await response.json());
      } catch {
        // WebSocket reconnect and the next poll continue to provide recovery.
      }
    };

    const connectWs = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(buildWsUrl());
        wsRef.current = ws;
        ws.onopen = () => { void fetchFallback(); };
        ws.onmessage = (event) => {
          try { handlePayload(JSON.parse(event.data)); } catch { /* Ignore malformed snapshots. */ }
        };
        ws.onclose = () => {
          wsRef.current = null;
          if (alive) reconnectTimerRef.current = setTimeout(connectWs, 3000);
        };
        ws.onerror = () => ws.close();
      } catch {
        // The fallback interval remains active when WebSocket is unavailable.
      }
    };

    connectWs();
    fallbackInterval = setInterval(fetchFallback, 1000);
    return () => {
      alive = false;
      wsRef.current?.close();
      wsRef.current = null;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [acceptAlarmSettings, addNotification, dataSource]);

  useEffect(() => {
    if (selectedDeviceId && devices[selectedDeviceId]) return;
    const nextDevice = sortedDevices.find((device) => device.online && device.latitude !== null && device.longitude !== null)
      || sortedDevices.find((device) => device.online)
      || sortedDevices[0];
    setSelectedDeviceId(nextDevice?.device_id || null);
  }, [devices, selectedDeviceId, sortedDevices]);

  useEffect(() => {
    Object.values(devices).forEach((device) => {
      const previous = previousOnlineByDeviceRef.current[device.device_id];
      if (previous !== undefined && previous !== device.online) {
        addNotification(`[设备 ${device.device_id}] ${device.online ? '已上线 (4G)' : '已离线'}`, device.online ? 'success' : 'error');
      }
      previousOnlineByDeviceRef.current[device.device_id] = device.online;
    });
  }, [addNotification, devices]);

  const sendCommandToSelected = useCallback(async (value: string, label = value): Promise<boolean> => {
    if (!selectedDeviceId) {
      addNotification('请先选择设备', 'warning');
      return false;
    }
    const target = devices[selectedDeviceId];
    if (!target || !target.online) {
      addNotification(`[设备 ${selectedDeviceId}] 当前离线，无法下发指令`, 'error');
      return false;
    }
    const url = `${dataSource}/send_cmd?device_id=${encodeURIComponent(selectedDeviceId)}&cmd=${encodeURIComponent(value)}`;
    try {
      const response = await fetch(url);
      const result = await response.json();
      const success = response.ok && result.status === 'success';
      addNotification(`[设备 ${selectedDeviceId}] 指令 [${label}] ${success ? '已下发' : '失败'}: ${result.msg || ''}`, success ? 'success' : 'error');
      return success;
    } catch {
      addNotification(`[设备 ${selectedDeviceId}] 指令发送失败，请检查网络`, 'error');
      return false;
    }
  }, [addNotification, dataSource, devices, selectedDeviceId]);

  const toggleLock = useCallback(() => setIsLocked((value) => !value), []);
  const clearNotifications = useCallback(() => setNotifications([]), []);
  const clearSelectedLogs = useCallback(() => {
    if (!selectedDeviceId) {
      addNotification('请先选择设备', 'warning');
      return;
    }
    setLogsByDevice((current) => ({ ...current, [selectedDeviceId]: [] }));
  }, [addNotification, selectedDeviceId]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#061525] font-sans text-slate-100">
      <MapSurface
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        isLocked={isLocked}
        mapTheme={mapTheme}
        onToggleLock={toggleLock}
        onChangeTheme={setMapTheme}
        onClearPath={clearPath}
        onExportTrajectory={exportTrajectory}
        onNotify={addNotification}
      />
      <LeftTelemetryDock
        devices={sortedDevices}
        device={selectedDevice}
        selectedDeviceId={selectedDeviceId}
        onSelectDevice={setSelectedDeviceId}
        displacementHistory={selectedDisplacement}
        alarmSettings={alarmSettings}
        alarmSettingsSaving={alarmSettingsSaving}
        onSaveAlarmSettings={saveAlarmSettings}
      />
      <aside className="pointer-events-auto absolute inset-y-0 right-0 z-20 flex w-[min(370px,calc(100vw-24px))] flex-col gap-3 overflow-y-auto border-l border-cyan-400/20 bg-[#041426]/82 p-3 shadow-[-12px_0_40px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="flex items-center justify-between px-1 py-1">
          <div>
            <p className="text-[10px] uppercase tracking-[0.25em] text-cyan-300/60">Operations console</p>
            <h1 className="text-base font-semibold tracking-wide text-slate-100">设备控制中心</h1>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] ${onlineDeviceCount ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : 'border-rose-400/25 bg-rose-400/10 text-rose-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${onlineDeviceCount ? 'bg-emerald-300' : 'bg-rose-300'}`} />{onlineDeviceCount}/{sortedDevices.length} 在线
          </div>
        </div>
        <CommandPanel devices={sortedDevices} selectedDeviceId={selectedDeviceId} selectedDevice={selectedDevice} onSelectDevice={setSelectedDeviceId} onSendCommand={sendCommandToSelected} />
        <NmeaPanel devices={sortedDevices} selectedDeviceId={selectedDeviceId} logs={selectedLogs} onSelectDevice={setSelectedDeviceId} onClear={clearSelectedLogs} />
        <NotificationPanel notifications={notifications} onClear={clearNotifications} />
        <div className="flex items-center justify-between px-1 pb-1 text-[10px] text-slate-500">
          <span className="flex items-center gap-1"><Radio className="h-3 w-3" />NMEA-0183 · 115200</span>
          <span className="flex items-center gap-1"><Activity className="h-3 w-3" />实时数据</span>
          <span className="flex items-center gap-1"><Satellite className="h-3 w-3" />{selectedDevice ? `${selectedDevice.satellites} 颗` : '--'}</span>
        </div>
      </aside>
    </div>
  );
}
