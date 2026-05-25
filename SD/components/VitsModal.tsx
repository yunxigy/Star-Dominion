import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Music2, ExternalLink } from 'lucide-react';
import { VITS_SONGS } from '../constants';

interface VitsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const VitsModal: React.FC<VitsModalProps> = ({ isOpen, onClose }) => {
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
          className="relative w-full max-w-lg bg-gradient-to-b from-slate-900 to-black border border-green-500/30 rounded-2xl shadow-[0_0_50px_rgba(34,197,94,0.2)] overflow-hidden"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-green-500/5">
            <h2 className="text-2xl font-bold text-green-400 flex items-center gap-2">
              <Music2 className="w-6 h-6" />
              VITS 成果展示
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* List */}
          <div className="p-6 space-y-4">
            <p className="text-slate-400 text-sm mb-4">
              以下是基于 VITS 模型训练与推理生成的语音合成作品（点击跳转 Bilibili）：
            </p>
            {VITS_SONGS.map((song, index) => (
              <motion.a
                key={song.id}
                href={song.url}
                target="_blank"
                rel="noopener noreferrer"
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: index * 0.1 }}
                className="group flex items-center justify-between p-4 rounded-lg bg-slate-800/50 border border-slate-700 hover:border-green-500/50 hover:bg-slate-800 transition-all cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center text-slate-500 group-hover:text-green-400 transition-colors">
                    <span className="text-xs font-mono">{index + 1}</span>
                  </div>
                  <span className="text-slate-200 font-medium group-hover:text-green-300 transition-colors">
                    {song.title}
                  </span>
                </div>
                <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs text-green-400 hidden group-hover:inline">Watch Video</span>
                  <ExternalLink className="w-4 h-4 text-green-400" />
                </div>
              </motion.a>
            ))}
          </div>
          
          <div className="p-4 bg-slate-900/80 text-center text-xs text-slate-600 border-t border-slate-800">
             Technical Demo • AI Voice Synthesis
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};