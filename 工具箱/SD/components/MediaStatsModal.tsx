import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Activity, AlertCircle, Wifi } from 'lucide-react';

interface MediaStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface StatData {
  label: string;
  value: string;
  change: string; // Keep as placeholder for real API as history isn't available in simple endpoints
  color: string;
  source: 'Real-time' | 'Simulated';
}

export const MediaStatsModal: React.FC<MediaStatsModalProps> = ({ isOpen, onClose }) => {
  // Bilibili Configuration
  const B_UID = '3493116143209321';
  
  // Initial Data State
  const [stats] = useState<StatData[]>([
    { label: 'B站播放 (Views)', value: '30.2万', change: '-', color: 'text-blue-400', source: 'Simulated' },
    { label: 'B站粉丝 (Fans)', value: '329', change: '-', color: 'text-pink-400', source: 'Simulated' },
    { label: 'B站获赞 (Likes)', value: '2.2万', change: '-', color: 'text-amber-400', source: 'Simulated' },
  ]);

  const platforms = [
    {
      name: '哔哩哔哩 Bilibili',
      url: `https://space.bilibili.com/${B_UID}`,
      color: 'from-pink-950/30 to-slate-900 border-pink-500/30 hover:border-pink-400',
      iconColor: 'text-pink-400',
      note: `UID: ${B_UID}`,
      status: '静态数据展示'
    },
    {
      name: '抖音 Douyin',
      url: 'https://www.douyin.com/user/self',
      color: 'from-slate-900 to-black border-slate-700 hover:border-white/50',
      iconColor: 'text-white',
      note: '逐梦光影的主页',
      status: '暂未连接'
    }
  ];

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
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50">
            <div>
              <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                <Activity className="w-6 h-6 text-blue-500" />
                数据监测面板
              </h2>
              <div className="flex items-center gap-2 mt-1">
                 <span className="text-xs text-slate-400 uppercase tracking-wider">Static Data Archive</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="p-6 space-y-8">
            
            {/* Stats Grid */}
            <div className="grid grid-cols-3 gap-4">
              {stats.map((stat, i) => (
                <div key={i} className="bg-slate-800/50 p-4 rounded-xl border border-slate-700/50 text-center relative overflow-hidden group">
                  <div className="text-slate-400 text-xs mb-1 flex justify-center items-center gap-1">
                    {stat.label}
                  </div>
                  <div className={`text-2xl font-bold ${stat.color} font-mono tracking-tight`}>{stat.value}</div>
                  <div className="text-[10px] text-slate-500 mt-2 flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-500" />
                    静态存档
                  </div>
                </div>
              ))}
            </div>

            {/* Platform Links */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-widest mb-2 flex items-center justify-between">
                <span>Platform Access</span>
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {platforms.map((p) => (
                  <a
                    key={p.name}
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`flex flex-col p-5 rounded-xl border bg-gradient-to-br transition-all duration-300 group hover:-translate-y-1 hover:shadow-lg ${p.color}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className={`font-bold text-lg ${p.iconColor}`}>{p.name}</span>
                      <ExternalLink className="w-5 h-5 text-slate-500 group-hover:text-white transition-colors" />
                    </div>
                    <span className="text-xs text-slate-300">{p.note}</span>
                    <span className="text-[10px] text-slate-500 mt-2 font-mono flex items-center gap-1">
                      {p.status.includes('静态') ? <Wifi className="w-3 h-3 text-green-500"/> : <AlertCircle className="w-3 h-3 text-yellow-500"/>}
                      {p.status}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between items-center text-xs text-slate-600">
             <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-slate-500" />
                Static Snapshot Mode
             </div>
             <span className="font-mono opacity-50">API Offline</span>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};