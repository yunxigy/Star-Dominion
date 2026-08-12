import React from 'react';
import { motion } from 'framer-motion';
import { Cpu, ExternalLink } from 'lucide-react';

const STM32_URL = '/stm32/';

export const Stm32Page: React.FC = () => {
  return (
    <div className="flex flex-col h-screen">
      {/* Header Bar */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between px-4 py-3 bg-slate-900/60 backdrop-blur-sm border-b border-amber-500/20 shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-amber-600 to-orange-600 shadow-lg">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-100">STM32 上位机</h1>
            <p className="text-xs text-slate-400">北斗边坡高精度定位监测系统</p>
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
          <div className="inline-flex p-4 rounded-full bg-amber-500/10 border border-amber-500/20 mb-6">
            <Cpu className="w-12 h-12 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-slate-200 mb-3">STM32 上位机</h2>
          <p className="text-slate-400 mb-6 leading-relaxed">
            北斗边坡高精度定位监测系统使用独立界面，点击下方按钮后在新标签页打开。
          </p>

          <a
            href={STM32_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg transition-colors font-medium"
          >
            <ExternalLink className="w-4 h-4" />
            打开上位机
          </a>
        </motion.div>
      </div>
    </div>
  );
};
