import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Heart, ExternalLink, RefreshCw, AlertCircle } from 'lucide-react';

const SHOUANREN_URL = '/wuwa/';

export const ShouAnRenPage: React.FC = () => {
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = () => {
    setLoadError(false);
    setIsLoading(true);
    if (iframeRef.current) {
      iframeRef.current.src = SHOUANREN_URL;
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (isLoading) {
        setLoadError(true);
        setIsLoading(false);
      }
    }, 8000);
    return () => clearTimeout(timer);
  }, [isLoading]);

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
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <a
            href="http://localhost:8000"
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-all"
            title="在新窗口打开"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>
      </motion.div>

      {/* Content Area */}
      <div className="flex-1 relative">
        {loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 z-10">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-center max-w-md p-8"
            >
              <div className="inline-flex p-4 rounded-full bg-red-500/10 border border-red-500/20 mb-6">
                <AlertCircle className="w-12 h-12 text-red-400" />
              </div>
              <h3 className="text-xl font-bold text-slate-200 mb-3">无法连接到守岸人</h3>
              <p className="text-slate-400 mb-6 leading-relaxed">
                请确保守岸人服务已启动（端口 8000）。
              </p>
              <div className="bg-slate-800/50 rounded-lg p-4 text-left mb-6 border border-slate-700/50">
                <p className="text-xs text-slate-500 mb-2 font-mono">启动命令：</p>
                <p className="text-sm text-cyan-400 font-mono">cd 守岸人3.0</p>
                <p className="text-sm text-cyan-400 font-mono">python -m server.main</p>
              </div>
              <button
                onClick={handleRefresh}
                className="px-6 py-2.5 bg-pink-600 hover:bg-pink-500 text-white rounded-lg transition-colors font-medium"
              >
                重新连接
              </button>
            </motion.div>
          </div>
        )}

        {isLoading && !loadError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">正在连接守岸人...</p>
            </div>
          </div>
        )}

        <iframe
          ref={iframeRef}
          src={SHOUANREN_URL}
          className="w-full h-full border-0 bg-slate-950"
          onLoad={() => setIsLoading(false)}
          onError={() => { setLoadError(true); setIsLoading(false); }}
          title="守岸人 3.0"
        />
      </div>
    </div>
  );
};
