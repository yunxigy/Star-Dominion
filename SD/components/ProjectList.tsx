import React from 'react';
import { PROJECTS_DATA } from '../constants';
import * as Icons from 'lucide-react';
import { motion } from 'framer-motion';

interface ProjectListProps {
  onOpenVits: () => void;
  onOpenMediaStats: () => void;
  onOpenGacha?: () => void;
  onOpenNovel?: () => void;
  onOpenReaction?: () => void;
}

export const ProjectList: React.FC<ProjectListProps> = ({ onOpenVits, onOpenMediaStats, onOpenGacha, onOpenNovel, onOpenReaction }) => {
  const handleProjectClick = (id: string) => {
    if (id === 'p2') { // VITS ID
      onOpenVits();
    } else if (id === 'p3') { // Media Creator ID
      onOpenMediaStats();
    } else if (id === 'p6') { // 2D Card Project ID
      if (onOpenGacha) onOpenGacha();
    } else if (id === 'p5') { // Novel ID
      if (onOpenNovel) onOpenNovel();
    } else if (id === 'p8') { // Reaction Test
      if (onOpenReaction) onOpenReaction();
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      <h2 className="text-2xl font-bold text-amber-200 border-b border-white/8 pb-2 mb-4 tracking-wider flex items-center gap-2">
        <Icons.Code2 className="w-6 h-6 text-amber-400" />
        个人项目
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {PROJECTS_DATA.map((project, index) => {
          const IconComponent = (Icons as any)[project.icon] || Icons.Folder;
          const isInteractive = project.id === 'p2' || project.id === 'p3' || project.id === 'p6' || project.id === 'p5' || project.id === 'p8';
          
          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: index * 0.1 }}
              onClick={() => handleProjectClick(project.id)}
              className={`group relative p-5 glass-card rounded-xl transition-all duration-300 ${
                isInteractive
                  ? 'cursor-pointer hover:border-amber-400/30 hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]'
                  : ''
              }`}
            >
               <div className="absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                 <IconComponent className="w-16 h-16 text-amber-500" />
               </div>
               
               <div className="relative z-10 flex items-start gap-4">
                 <div className={`p-3 bg-white/5 rounded-lg border border-white/8 transition-colors ${
                   isInteractive ? 'group-hover:border-amber-400/40 group-hover:bg-amber-500/10' : ''
                 }`}>
                   <IconComponent className="w-8 h-8 text-amber-400" />
                 </div>
                 <div>
                   <h3 className="text-lg font-bold text-amber-50 group-hover:text-amber-300 transition-colors flex items-center gap-2">
                     {project.title}
                     {isInteractive && <Icons.ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />}
                   </h3>
                   <p className="text-sm text-slate-400 mt-1">
                     {project.description}
                   </p>
                 </div>
               </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};