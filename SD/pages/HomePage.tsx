import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { getIcon } from '../lib/iconMap';
import { PlanSection } from '../components/PlanSection';
import { VitsModal } from '../components/VitsModal';
import { GalleryModal } from '../components/GalleryModal';
import { AeModal } from '../components/AeModal';

const navCards = [
  {
    title: '星盟组成',
    description: '十三星阁，构筑未来帝国蓝图',
    path: '/zm',
    icon: 'Orbit',
    color: 'blue',
    gradient: 'from-blue-600 to-cyan-600',
    glow: 'rgba(59,130,246,0.3)',
  },
  {
    title: '逐梦工具箱',
    description: '个人项目与创作探索集合',
    path: '/gj',
    icon: 'Wrench',
    color: 'amber',
    gradient: 'from-amber-600 to-orange-600',
    glow: 'rgba(245,158,11,0.3)',
  },
  {
    title: '智创翻译',
    description: 'AI 驱动的智能翻译工作台',
    path: '/fy',
    icon: 'Languages',
    color: 'emerald',
    gradient: 'from-emerald-600 to-teal-600',
    glow: 'rgba(16,185,129,0.3)',
  },
  {
    title: '边坡上位机',
    description: 'STM32 北斗边坡高精度定位监控',
    path: '/bp',
    icon: 'Satellite',
    color: 'cyan',
    gradient: 'from-cyan-600 to-sky-600',
    glow: 'rgba(6,182,212,0.3)',
  },
  {
    title: '我与花之诗',
    description: '文字间的浪漫与哲思',
    path: '/hs',
    icon: 'Flower2',
    color: 'pink',
    gradient: 'from-pink-600 to-rose-600',
    glow: 'rgba(236,72,153,0.3)',
  },
  {
    title: '网文智能体',
    description: 'AI 自主长篇小说写作系统',
    path: '/ai',
    icon: 'Bot',
    color: 'violet',
    gradient: 'from-violet-600 to-purple-600',
    glow: 'rgba(139,92,246,0.3)',
  },
  {
    title: '论文查重',
    description: '自建库双论文相似度检测',
    path: '/lwc',
    icon: 'FileSearch',
    color: 'red',
    gradient: 'from-red-600 to-rose-600',
    glow: 'rgba(239,68,68,0.3)',
  },
];

export const HomePage: React.FC = () => {
  const [isVitsOpen, setIsVitsOpen] = useState(false);
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [isAeOpen, setIsAeOpen] = useState(false);

  return (
    <>
      {/* Header */}
      <header className="mb-20 text-center relative group">
        <div className="absolute inset-0 flex items-center justify-center -z-10 opacity-30 group-hover:opacity-50 transition-opacity duration-1000">
          <div className="w-64 h-64 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-full blur-[90px]" />
        </div>

        <div className="relative inline-block transform -skew-x-6 -rotate-2 hover:scale-105 hover:rotate-0 transition-all duration-500 cursor-default">
          <h1 className="font-art text-7xl sm:text-8xl md:text-[11rem] font-medium text-black absolute top-2 left-2 sm:top-5 sm:left-5 select-none z-0 opacity-80 whitespace-nowrap tracking-[0.2em]">
            逐梦光影
          </h1>
          <h1 className="font-art text-7xl sm:text-8xl md:text-[11rem] font-medium text-cyan-500 absolute top-0 left-0 select-none z-0 blur-xl opacity-50 animate-pulse-slow whitespace-nowrap tracking-[0.2em]">
            逐梦光影
          </h1>
          <h1 className="font-art text-7xl sm:text-8xl md:text-[11rem] font-medium text-transparent bg-clip-text bg-gradient-to-b from-white via-cyan-100 to-slate-400 relative z-10 drop-shadow-sm whitespace-nowrap tracking-[0.2em]">
            逐梦光影
          </h1>
        </div>

        <div className="mt-12 flex flex-col items-center">
          <div className="h-px w-32 bg-gradient-to-r from-transparent via-cyan-500 to-transparent opacity-50 mb-4" />
          <p className="text-slate-400 font-serif italic tracking-[0.3em] text-sm md:text-base uppercase text-shadow-sm">
            Chasing Dreams • Light & Shadow
          </p>
        </div>
      </header>

      {/* Navigation Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-6 mb-16">
        {navCards.map((card, index) => {
          const IconComponent = getIcon(card.icon);
          return (
            <motion.div
              key={card.path}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
            >
              <Link
                to={card.path}
                className="block group relative p-6 rounded-2xl glass-card overflow-hidden transition-all duration-500 hover:shadow-[0_0_30px_var(--glow)] hover:-translate-y-1"
                style={{ '--glow': card.glow } as React.CSSProperties}
              >
                {/* Background gradient on hover */}
                <div className={`absolute inset-0 bg-gradient-to-br ${card.gradient} opacity-0 group-hover:opacity-[0.08] transition-opacity duration-500`} />

                {/* Icon */}
                <div className={`relative mb-4 inline-flex p-3 rounded-xl bg-gradient-to-br ${card.gradient} shadow-lg`}>
                  <IconComponent className="w-7 h-7 text-white" />
                </div>

                {/* Text */}
                <h3 className="relative text-xl font-bold text-slate-100 group-hover:text-white transition-colors mb-2">
                  {card.title}
                </h3>
                <p className="relative text-sm text-slate-400 group-hover:text-slate-300 transition-colors">
                  {card.description}
                </p>

                {/* Arrow indicator */}
                <div className="relative mt-4 flex items-center gap-1 text-sm text-slate-500 group-hover:text-slate-300 transition-colors">
                  <span>进入</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Plans Section */}
      <PlanSection
        onOpenVits={() => setIsVitsOpen(true)}
        onOpenGallery={() => setIsGalleryOpen(true)}
        onOpenAe={() => setIsAeOpen(true)}
      />

      {/* Modals */}
      {isVitsOpen && <VitsModal isOpen={isVitsOpen} onClose={() => setIsVitsOpen(false)} />}
      {isGalleryOpen && <GalleryModal isOpen={isGalleryOpen} onClose={() => setIsGalleryOpen(false)} />}
      {isAeOpen && <AeModal isOpen={isAeOpen} onClose={() => setIsAeOpen(false)} />}
    </>
  );
};
