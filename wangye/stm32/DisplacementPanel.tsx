import { BarChart3 } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { DeviceSelector } from './DeviceSelector';
import type { DeviceRecord, DisplacementPoint } from './types';

interface DisplacementPanelProps {
  devices: DeviceRecord[];
  selectedDeviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
  history: DisplacementPoint[];
}

const SERIES = [
  { key: 'x', rawKey: 'raw_x', label: 'E 东向', color: '#22d3ee' },
  { key: 'y', rawKey: 'raw_y', label: 'N 北向', color: '#34d399' },
  { key: 'z', rawKey: 'raw_z', label: 'U 天向', color: '#fb923c' },
] as const;

export function DisplacementPanel({ devices, selectedDeviceId, onSelectDevice, history }: DisplacementPanelProps) {
  const gnss = devices.find((device) => device.device_id === selectedDeviceId)?.gnss;
  const status = !gnss ? '等待后端位移数据'
    : gnss.status === 'reference_building' ? `固定参考准备中 ${gnss.reference_progress}/${gnss.reference_required}`
      : ({ measured: '固定解 · 已滤波', prediction: '短时预测', expired: '定位数据过期',
        no_data: '等待合格固定解', checkpoint_error: '参考状态读取失败' } as Record<string, string>)[gnss.status] || '等待合格固定解';
  return (
    <section className="rounded-xl border border-cyan-300/15 bg-[#06182d]/88 p-3 shadow-[0_10px_30px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <div className="mb-2 flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-cyan-300" />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-cyan-300/65">Movement trend</p>
          <h2 className="text-sm font-semibold text-slate-100">ENU 累计位移</h2>
        </div>
      </div>
      <div className="mb-2">
        <DeviceSelector devices={devices} value={selectedDeviceId} onChange={onSelectDevice} />
        <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
          <span>{status}</span><span>灰色 原始 · 彩色 滤波</span>
        </div>
        {gnss?.persistence_error && <p className="mt-1 text-[10px] text-amber-300">位移记录保存异常</p>}
      </div>
      <div className="space-y-2">
        {SERIES.map((series, index) => {
          const latest = gnss?.valid ? gnss.filtered_enu_mm?.[index] : null;
          return (
            <div key={series.key} className="rounded-lg border border-cyan-300/10 bg-[#0a2139]/90 p-2">
              <div className="mb-1 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-400">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: series.color }} />
                  {series.label}
                </div>
                <span className="font-mono text-[10px]" style={{ color: series.color }}>{latest == null ? '--' : (latest / 10).toFixed(2)} cm</span>
              </div>
              <div className="h-[58px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={history}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e405c" vertical={false} />
                    <XAxis dataKey="time" hide />
                    <YAxis stroke="#64748b" fontSize={8} tickLine={false} axisLine={false} width={25} />
                    <Tooltip contentStyle={{ backgroundColor: '#071b31', border: '1px solid #1d5a76', borderRadius: '8px', fontSize: '10px', color: '#e2e8f0' }} />
                    <Line name="原始 / cm" type="linear" dataKey={series.rawKey} stroke="#94a3b8" strokeWidth={1} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line name="滤波 / cm" type="linear" dataKey={series.key} stroke={series.color} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
