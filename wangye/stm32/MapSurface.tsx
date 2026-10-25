import { Download, Lock, Map as MapIcon, Trash2, Unlock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';
import type { DeviceRecord, MapTheme } from './types';
import { deviceColor } from './telemetry';

interface MapSurfaceProps {
  devices: Record<string, DeviceRecord>;
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
  isLocked: boolean;
  mapTheme: MapTheme;
  onToggleLock: () => void;
  onChangeTheme: (theme: MapTheme) => void;
  onClearPath: (deviceId: string) => void;
  onExportTrajectory: (deviceId: string, path: [number, number][]) => void;
  onNotify: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

function markerContent(device: DeviceRecord, selected: boolean): string {
  const color = deviceColor(device);
  const size = selected ? 48 : 40;
  const border = selected ? '3px solid #67e8f9' : '2px solid rgba(226,232,240,0.9)';
  return `<div title="设备 ${device.device_id}" style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:${border};box-shadow:0 0 ${selected ? 22 : 12}px ${color};display:flex;align-items:center;justify-content:center;color:#00111d;font:700 12px/1 Bahnschrift,Arial,sans-serif;white-space:nowrap;transform:translate(-50%,-50%);">${device.device_id}</div>`;
}

export function MapSurface({
  devices,
  selectedDeviceId,
  onSelectDevice,
  isLocked,
  mapTheme,
  onToggleLock,
  onChangeTheme,
  onClearPath,
  onExportTrajectory,
  onNotify,
}: MapSurfaceProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const amapRef = useRef<any>(null);
  const markerRefsRef = useRef<Record<string, any>>({});
  const polylineRefsRef = useRef<Record<string, any>>({});
  const pathsRef = useRef<Record<string, [number, number][]>>({});
  const mapHasFittedRef = useRef(false);
  const mapConfigurationReportedRef = useRef(false);

  const clearMapLayers = () => {
    Object.values(markerRefsRef.current).forEach((marker) => marker?.setMap?.(null));
    Object.values(polylineRefsRef.current).forEach((polyline) => polyline?.setMap?.(null));
    markerRefsRef.current = {};
    polylineRefsRef.current = {};
  };

  useEffect(() => {
    if (!mapContainerRef.current) return undefined;
    const amapKey = import.meta.env.VITE_AMAP_KEY?.trim();
    const amapSecurityCode = import.meta.env.VITE_AMAP_SECURITY_CODE?.trim();
    if (!amapKey || !amapSecurityCode) {
      if (!mapConfigurationReportedRef.current) {
        mapConfigurationReportedRef.current = true;
        onNotify('地图未配置，请设置 VITE_AMAP_KEY 和 VITE_AMAP_SECURITY_CODE', 'error');
      }
      return undefined;
    }

    let disposed = false;
    (window as any)._AMapSecurityConfig = { securityJsCode: amapSecurityCode };
    AMapLoader.load({
      key: amapKey,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.ToolBar', 'AMap.ControlBar', 'AMap.Polyline'],
    })
      .then((AMap) => {
        if (disposed || !mapContainerRef.current) return;
        const map = new AMap.Map(mapContainerRef.current, {
          zoom: 17,
          center: [117.993469, 36.810429],
          viewMode: '3D',
          pitch: 42,
          mapStyle: mapTheme === 'dark' ? 'amap://styles/darkblue' : undefined,
          layers: mapTheme === 'satellite' ? [new AMap.TileLayer.Satellite()] : [],
        });
        map.addControl(new AMap.Scale());
        map.addControl(new AMap.ToolBar());
        amapRef.current = AMap;
        mapRef.current = map;
        mapHasFittedRef.current = false;
      })
      .catch(() => onNotify('地图加载失败，请检查 API Key 或网络', 'error'));

    return () => {
      disposed = true;
      clearMapLayers();
      if (mapRef.current) mapRef.current.destroy();
      mapRef.current = null;
      amapRef.current = null;
    };
  }, [mapTheme, onNotify]);

  useEffect(() => {
    const map = mapRef.current;
    const AMap = amapRef.current;
    if (!map || !AMap) return;

    const visibleIds = new Set<string>();
    const visibleMarkers: any[] = [];
    Object.values(devices).forEach((device) => {
      if (!Number.isFinite(device.latitude) || !Number.isFinite(device.longitude)) return;

      const id = device.device_id;
      const position: [number, number] = [device.longitude as number, device.latitude as number];
      const selected = id === selectedDeviceId;
      visibleIds.add(id);

      let marker = markerRefsRef.current[id];
      if (!marker) {
        marker = new AMap.Marker({ position, offset: new AMap.Pixel(0, 0), content: markerContent(device, selected) });
        marker.on('click', () => onSelectDevice(id));
        map.add(marker);
        markerRefsRef.current[id] = marker;
      } else {
        marker.setPosition(position);
        marker.setContent(markerContent(device, selected));
      }

      const currentPath = pathsRef.current[id] || [];
      const lastPosition = currentPath[currentPath.length - 1];
      const changed = !lastPosition
        || Math.abs(lastPosition[0] - position[0]) > 0.0000001
        || Math.abs(lastPosition[1] - position[1]) > 0.0000001;
      if (changed) {
        pathsRef.current[id] = [...currentPath.slice(-998), position];
      }

      let polyline = polylineRefsRef.current[id];
      if (!polyline) {
        polyline = new AMap.Polyline({ path: pathsRef.current[id], strokeColor: deviceColor(device), strokeWeight: selected ? 5 : 3, strokeOpacity: 0.82, lineJoin: 'round', showDir: true });
        map.add(polyline);
        polylineRefsRef.current[id] = polyline;
      } else {
        polyline.setPath(pathsRef.current[id]);
        polyline.setOptions?.({ strokeColor: deviceColor(device), strokeWeight: selected ? 5 : 3 });
      }
      visibleMarkers.push(marker);
    });

    Object.keys(markerRefsRef.current).forEach((id) => {
      if (!visibleIds.has(id)) {
        markerRefsRef.current[id]?.setMap?.(null);
        polylineRefsRef.current[id]?.setMap?.(null);
        delete markerRefsRef.current[id];
        delete polylineRefsRef.current[id];
      }
    });

    if (!mapHasFittedRef.current && visibleMarkers.length > 0) {
      map.setFitView(visibleMarkers, false, [110, 110, 110, 420]);
      mapHasFittedRef.current = true;
    }

    const selected = selectedDeviceId ? devices[selectedDeviceId] : null;
    if (isLocked && selected && Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude)) {
      map.setCenter([selected.longitude as number, selected.latitude as number]);
    }
  }, [devices, selectedDeviceId, isLocked, onSelectDevice]);

  const clearSelectedPath = () => {
    if (!selectedDeviceId) {
      onNotify('请先选择设备再清除轨迹', 'warning');
      return;
    }
    pathsRef.current[selectedDeviceId] = [];
    polylineRefsRef.current[selectedDeviceId]?.setPath?.([]);
    onClearPath(selectedDeviceId);
  };

  const exportSelectedPath = () => {
    if (!selectedDeviceId) {
      onNotify('请先选择设备再导出轨迹', 'warning');
      return;
    }
    const path = pathsRef.current[selectedDeviceId] || [];
    if (!path.length) {
      onNotify('当前设备没有可导出的轨迹', 'warning');
      return;
    }
    onExportTrajectory(selectedDeviceId, path);
  };

  return (
    <div className="absolute inset-0 z-0">
      <div ref={mapContainerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-1/2 top-5 z-10 -translate-x-1/2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-300/20 bg-[#06182d]/80 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-xl">
          <MapIcon className="h-3.5 w-3.5 text-cyan-300" />
          <span>实时边坡地图</span>
          <span className="text-[10px] text-slate-500">{Object.keys(devices).length} 台设备</span>
        </div>
        <div className="pointer-events-auto mt-2 flex justify-center gap-1 rounded-full border border-cyan-300/15 bg-[#06182d]/75 p-1 backdrop-blur-xl">
          <button type="button" onClick={onToggleLock} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:bg-cyan-300/10 hover:text-cyan-100">
            {isLocked ? <Lock className="h-3 w-3 text-cyan-300" /> : <Unlock className="h-3 w-3 text-slate-500" />}
            {isLocked ? '锁定当前设备' : '自由视角'}
          </button>
          <button type="button" onClick={clearSelectedPath} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:bg-rose-400/10 hover:text-rose-200"><Trash2 className="h-3 w-3" />清除</button>
          <button type="button" onClick={exportSelectedPath} className="flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold text-slate-300 transition hover:bg-emerald-400/10 hover:text-emerald-200"><Download className="h-3 w-3" />导出</button>
        </div>
        <div className="pointer-events-auto mt-2 flex justify-center gap-1 rounded-full border border-cyan-300/15 bg-[#06182d]/75 p-1 backdrop-blur-xl">
          {(['dark', 'normal', 'satellite'] as MapTheme[]).map((theme) => (
            <button key={theme} type="button" onClick={() => onChangeTheme(theme)} className={`rounded-full px-2 py-1 text-[10px] font-semibold transition ${mapTheme === theme ? 'bg-cyan-300/20 text-cyan-100' : 'text-slate-500 hover:text-slate-200'}`}>
              {theme === 'dark' ? '深色' : theme === 'normal' ? '标准' : '卫星'}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
