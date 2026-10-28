import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Book, ChevronRight, ScrollText, Calendar, User, Hash } from 'lucide-react';

interface NovelModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Chapter {
  id: number;
  title: string;
  date: string;
  wordCount: string;
  content: string;
}

const CHAPTERS: Chapter[] = [
  {
    id: 1,
    title: '第一章：觉醒S级：舰船？',
    date: '2026-02-20',
    wordCount: '6887字',
    content: '这里是第一章的内容预览...（由于篇幅限制，仅展示目录结构）'
  },
  {
    id: 2,
    title: '第二章：来一瓶82年的拉菲',
    date: '2026-02-25',
    wordCount: '3200字',
    content: '这里是第二章的内容预览...（由于篇幅限制，仅展示目录结构）'
  }
];

export const NovelModal: React.FC<NovelModalProps> = ({ isOpen, onClose }) => {
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);

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
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-md"
        />

        {/* Content Container */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          className="relative w-full max-w-4xl bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-950/50 shrink-0">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20">
                <Book className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">糟糕，我被舰娘包围了</h2>
                <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                  <span className="flex items-center gap-1"><User className="w-3 h-3" /> 逐梦光影</span>
                  <span className="flex items-center gap-1"><Hash className="w-3 h-3" /> 连载中</span>
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> 最近更新: 2026-02-25</span>
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedChapter ? (
              <div className="space-y-6">
                {/* Novel Info Card */}
                <div className="p-6 bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <h3 className="text-lg font-semibold text-amber-200 mb-3 flex items-center gap-2">
                    <ScrollText className="w-5 h-5" />
                    作品简介
                  </h3>
                  <p className="text-slate-300 leading-relaxed italic">
                    “我只是想当一个普通的指挥官，为什么港区的大家看我的眼神越来越不对劲了？”
                    <br />
                    这是一个关于意外穿越到港区，被性格各异的舰娘们“包围”的温馨（修罗场）故事。
                  </p>
                </div>

                {/* Table of Contents */}
                <div>
                  <h3 className="text-lg font-semibold text-slate-200 mb-4 flex items-center gap-2">
                    目录 (共 {CHAPTERS.length} 章)
                  </h3>
                  <div className="grid grid-cols-1 gap-3">
                    {CHAPTERS.map((chapter) => (
                      <motion.button
                        key={chapter.id}
                        whileHover={{ x: 10 }}
                        onClick={() => setSelectedChapter(chapter)}
                        className="flex items-center justify-between p-4 bg-slate-800/30 border border-slate-700 rounded-xl hover:border-amber-500/50 hover:bg-slate-800/50 transition-all text-left group"
                      >
                        <div className="flex items-center gap-4">
                          <span className="text-amber-500/50 font-mono text-sm">#{chapter.id.toString().padStart(2, '0')}</span>
                          <div>
                            <div className="text-slate-200 font-medium group-hover:text-amber-300 transition-colors">
                              {chapter.title}
                            </div>
                            <div className="text-xs text-slate-500 mt-1">
                              {chapter.date} · {chapter.wordCount}
                            </div>
                          </div>
                        </div>
                        <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-amber-500 transition-colors" />
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <button
                  onClick={() => setSelectedChapter(null)}
                  className="text-amber-500 hover:text-amber-400 text-sm flex items-center gap-1 mb-4"
                >
                  <ChevronRight className="w-4 h-4 rotate-180" /> 返回目录
                </button>
                
                <div className="text-center space-y-2 mb-8">
                  <h3 className="text-3xl font-bold text-white">{selectedChapter.title}</h3>
                  <div className="text-sm text-slate-500">
                    发布时间: {selectedChapter.date} | 字数: {selectedChapter.wordCount}
                  </div>
                </div>

                <div className="prose prose-invert max-w-none">
                  <div className="p-8 bg-slate-800/30 rounded-2xl border border-slate-700/50 text-slate-300 leading-loose text-lg font-serif">
                    {selectedChapter.content}
                    <div className="mt-12 p-4 border-t border-slate-700 text-center text-slate-500 text-sm italic">
                      —— 章节内容正在完善中，敬请期待 ——
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-slate-950 border-t border-slate-800 text-center text-xs text-slate-500 shrink-0">
            逐梦光影 · 网文创作项目 · © 2026
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
