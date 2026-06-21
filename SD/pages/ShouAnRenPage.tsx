import React, { useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart, ExternalLink, AlertCircle } from 'lucide-react';

// 根据环境自动选择 URL
const getShouAnRenUrl = () => {
  const host = window.location.hostname;
  // 云端部署：通过 /api/ 路由访问守岸人
  if (host !== 'localhost' && host !== '127.0.0.1') {
    return `${window.location.protocol}//${host}`;
  }
  // 本地开发：直接访问端口 8000
  return 'http://localhost:8000';
};

export const ShouAnRenPage: React.FC = () => {
  const shouanrenUrl = getShouAnRenUrl();

  // Auto-open in new tab, show info page
  useEffect(() => {
    window.open(shouanrenUrl, '_blank');
  }, [shouanrenUrl]);

  return (
    <div className="flex flex-col h-screen">
      {/* Header Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-4 py-3 bg-slate-900/60 backdrop-blur-sm border-b border-pink-500/20 shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-pink-600 to-rose-600 shadow-lg">
            <Heart className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">AI 伴侣</h1>
            <p className="text-xs text-slate-400">守岸人 3.0 — AI 角色对话与互动剧情</p>
          </div>
        </div>
      </motion.div>

      {/* Info Card */}
      <div className="flex-1 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center max-w-md p-8"
        >
          <div className="inline-flex p-4 rounded-full bg-pink-500/10 border border-pink-500/20 mb-6">
            <Heart className="w-12 h-12 text-pink-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-200 mb-3">守岸人已在新窗口打开</h2>
          <p className="text-slate-400 mb-6 leading-relaxed">
            守岸人使用独立前端，已自动在新标签页打开。
          </p>

          <a
            href={shouanrenUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-pink-600 hover:bg-pink-500 text-white rounded-lg transition-colors font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            再次打开守岸人
          </a>

          <div className="mt-8 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50 text-left">
            <p className="text-xs text-slate-500 mb-2">服务地址</p>
            <p className="text-sm text-cyan-400 font-mono">{shouanrenUrl}</p>
            <p className="text-xs text-slate-500 mt-3 mb-2">启动命令</p>
            <p className="text-sm text-cyan-400 font-mono">cd 守岸人3.0 && python -m server.main</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
