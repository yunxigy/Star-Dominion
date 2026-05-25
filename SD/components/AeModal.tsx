import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clapperboard, Video, Link as LinkIcon, Download } from 'lucide-react';

interface AeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AeModal: React.FC<AeModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
        />

        {/* Content */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 50 }}
          className="relative w-full max-w-lg bg-gradient-to-b from-slate-900 to-slate-950 border border-purple-500/30 rounded-2xl shadow-[0_0_50px_rgba(168,85,247,0.2)] overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-purple-500/5">
            <h2 className="text-2xl font-bold text-purple-400 flex items-center gap-2">
              <Clapperboard className="w-6 h-6" />
              AE 创作空间
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 space-y-8">
            
            {/* Portfolio Section */}
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Video className="w-4 h-4" />
                作品集 Portfolio
              </h3>
              <a 
                href="https://www.douyin.com/user/self?from_tab_name=main&modal_id=7558128323520367898&showTab=post"
                target="_blank"
                rel="noopener noreferrer"
                className="group block p-4 rounded-xl bg-slate-800/50 border border-slate-700 hover:bg-slate-800 hover:border-purple-500/50 transition-all hover:shadow-lg hover:shadow-purple-500/10"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-lg font-bold text-slate-200 group-hover:text-purple-300 transition-colors">音频可视化</h4>
                    <p className="text-xs text-slate-500 mt-1">Audio Visualization Project</p>
                  </div>
                  <LinkIcon className="w-5 h-5 text-slate-500 group-hover:text-purple-400 transition-colors" />
                </div>
                <div className="mt-3 text-xs text-slate-400 font-mono bg-slate-900/50 p-2 rounded truncate border border-slate-700/50">
                   douyin.com/video/7558128...
                </div>
              </a>
            </div>

            {/* Resources Section */}
            <div>
              <h3 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Download className="w-4 h-4" />
                资源网 Resources
              </h3>
              <div className="grid gap-3">
                <a 
                  href="https://www.aigei.com/s?type=ae&q=%E6%AD%8C%E8%AF%8D%E5%8F%AF%E8%A7%86%E5%8C%96&page=3#resContainer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:bg-slate-800 hover:border-blue-500/30 transition-all"
                >
                   <div className="flex items-center gap-3">
                     <span className="w-8 h-8 rounded-full bg-blue-900/20 text-blue-400 flex items-center justify-center font-bold text-xs">AG</span>
                     <span className="text-slate-300 font-medium">爱给网 (Aigei)</span>
                   </div>
                   <span className="text-xs text-slate-500 group-hover:text-slate-300">AE模板/素材</span>
                </a>

                <a 
                  href="https://www.newcger.com/aemoban/48077"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:bg-slate-800 hover:border-orange-500/30 transition-all"
                >
                   <div className="flex items-center gap-3">
                     <span className="w-8 h-8 rounded-full bg-orange-900/20 text-orange-400 flex items-center justify-center font-bold text-xs">NC</span>
                     <span className="text-slate-300 font-medium">新CG儿 (NewCGer)</span>
                   </div>
                   <span className="text-xs text-slate-500 group-hover:text-slate-300">免费AE模板</span>
                </a>
              </div>
            </div>

          </div>
          
          <div className="p-4 bg-slate-950/80 text-center text-xs text-slate-600 border-t border-slate-800">
             Motion Graphics • VFX • Learning Path
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};