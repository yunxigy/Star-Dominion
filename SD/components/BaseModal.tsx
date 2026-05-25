import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

interface BaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  icon: React.ReactNode;
  colorClass: string;  // e.g. 'text-red-400'
  borderColor: string; // e.g. 'border-red-500/30'
  headerBg: string;    // e.g. 'bg-red-500/5'
  maxWidth?: string;   // e.g. 'max-w-2xl' | 'max-w-4xl'
  footer?: string;     // footer text
  children: React.ReactNode;
}

export const BaseModal: React.FC<BaseModalProps> = ({
  isOpen, onClose, title, icon, colorClass, borderColor, headerBg,
  maxWidth = 'max-w-2xl', footer = '纯前端处理 • 数据不会上传到服务器',
  children,
}) => {
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
          className="absolute inset-0 bg-black/60 backdrop-blur-md"
        />

        {/* Modal panel */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.92, opacity: 0, y: 30 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`relative w-full ${maxWidth} bg-slate-900/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 overflow-hidden max-h-[85vh] flex flex-col`}
        >
          {/* Header */}
          <div className={`p-5 border-b border-white/8 flex justify-between items-center ${headerBg} shrink-0`}>
            <h2 className={`text-xl font-bold ${colorClass} flex items-center gap-2`}>
              {icon}
              {title}
            </h2>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {children}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-white/3 text-center text-xs text-slate-500 border-t border-white/5 shrink-0">
            {footer}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
