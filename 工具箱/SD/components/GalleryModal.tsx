import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Palette, Image as ImageIcon, ExternalLink } from 'lucide-react';

interface GalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GalleryModal: React.FC<GalleryModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/90 backdrop-blur-lg"
        />

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative w-full max-w-4xl h-[80vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-900 z-10">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-500/10 rounded-lg">
                <Palette className="w-6 h-6 text-purple-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-100">我的画廊</h2>
                <p className="text-xs text-slate-400">My Artworks & Sketches</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 transition-colors">
              <X className="w-6 h-6 text-slate-400" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto p-6">
            
            {/* Pixiv Link Banner */}
            <a 
              href="https://www.pixiv.net/" 
              target="_blank" 
              rel="noopener noreferrer"
              className="block mb-8 p-6 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 relative overflow-hidden group hover:shadow-lg hover:shadow-cyan-500/20 transition-all"
            >
              <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-white/20 rounded-full blur-2xl group-hover:scale-150 transition-transform duration-700" />
              <div className="relative z-10 flex items-center justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-white mb-1">访问我的 Pixiv 主页</h3>
                  <p className="text-blue-100 text-sm">查看完整的高清作品集与约稿信息</p>
                </div>
                <ExternalLink className="w-6 h-6 text-white opacity-80 group-hover:translate-x-1 transition-transform" />
              </div>
            </a>

            <h3 className="text-sm font-bold text-slate-500 mb-4 uppercase tracking-wider">精选作品 Preview</h3>
            
            {/* Gallery Grid (Placeholders) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((item) => (
                <div key={item} className="aspect-[3/4] rounded-lg bg-slate-800 border border-slate-700 relative group overflow-hidden cursor-pointer">
                  <div className="absolute inset-0 flex items-center justify-center text-slate-600 group-hover:text-slate-400 transition-colors">
                    <ImageIcon className="w-8 h-8 opacity-50" />
                  </div>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <span className="text-white text-sm font-medium">Artwork #{item}</span>
                    <span className="text-slate-400 text-xs">2023.10.12</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};