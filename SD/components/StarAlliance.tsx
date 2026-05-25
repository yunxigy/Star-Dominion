import React from 'react';
import { STAR_ALLIANCE_DATA } from '../constants';
import * as Icons from 'lucide-react';
import { motion } from 'framer-motion';

export const StarAlliance: React.FC = () => {
  return (
    <div className="flex flex-col space-y-4">
      <h2 className="text-2xl font-bold text-blue-200 border-b border-blue-800 pb-2 mb-4 tracking-wider flex items-center gap-2">
        <Icons.Orbit className="w-6 h-6 text-blue-400" />
        星盟组成
      </h2>
      <div className="space-y-4">
        {STAR_ALLIANCE_DATA.map((item, index) => {
          // Dynamic Icon loading
          const IconComponent = (Icons as any)[item.icon] || Icons.Star;

          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="p-5 rounded-xl border border-slate-700 bg-slate-900/40 relative overflow-hidden group hover:border-blue-500/50 hover:bg-slate-800/60 transition-all duration-300 hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]"
            >
              {/* Header Line */}
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 rounded-full bg-slate-800 group-hover:bg-blue-900 transition-colors border border-slate-700 group-hover:border-blue-700">
                    <IconComponent className="w-5 h-5 text-blue-400 group-hover:text-blue-200" />
                  </div>
                  <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-lg font-bold text-blue-100 group-hover:text-white transition-colors">
                          {item.name}
                        </span>
                        <span className="px-2 py-0.5 rounded text-xs font-mono font-medium border border-blue-500/30 bg-blue-500/10 text-blue-300">
                          {item.companyName}
                        </span>
                    </div>
                    <span className="hidden sm:inline text-slate-600">|</span>
                    <span className="text-sm font-medium text-cyan-500/80 group-hover:text-cyan-400">
                      {item.tag}
                    </span>
                  </div>
                </div>
              </div>

              {/* Description Body - Always Visible */}
              <div className="pl-[3.25rem]">
                <p className="text-slate-400 text-sm leading-relaxed group-hover:text-slate-300 transition-colors">
                  {item.description}
                </p>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};