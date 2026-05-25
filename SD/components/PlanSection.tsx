import React from 'react';
import { PLANS_DATA } from '../constants';
import { PlanStatus } from '../types';
import { CheckCircle2, Clock, PauseCircle, HelpCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface PlanSectionProps {
  onOpenVits: () => void;
  onOpenGallery: () => void;
  onOpenAe: () => void;
}

export const PlanSection: React.FC<PlanSectionProps> = ({ onOpenVits, onOpenGallery, onOpenAe }) => {
  const getStatusConfig = (status: PlanStatus) => {
    switch (status) {
      case PlanStatus.DONE:
        return { icon: CheckCircle2, color: 'text-green-400', ring: 'ring-green-500/20' };
      case PlanStatus.DOING:
        return { icon: Clock, color: 'text-blue-400', ring: 'ring-blue-500/20 animate-pulse-slow' };
      case PlanStatus.SHELVED:
        return { icon: PauseCircle, color: 'text-slate-500', ring: '' };
      default:
        return { icon: HelpCircle, color: 'text-slate-500', ring: '' };
    }
  };

  return (
    <div className="mt-16 relative">
      <div className="text-center mb-10">
        <h3 className="text-3xl font-art text-transparent bg-clip-text bg-gradient-to-r from-pink-300 via-purple-300 to-indigo-300 drop-shadow-lg">
          去想，去做，去看，莫要辜负年华！
        </h3>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {PLANS_DATA.map((plan, index) => {
          const config = getStatusConfig(plan.status);
          const Icon = config.icon;
          
          // ID 4 is VITS, ID 1 is Painting, ID 9 is AE
          const isVits = plan.id === '4'; 
          const isPainting = plan.id === '1';
          const isAe = plan.id === '9';
          const isInteractive = isVits || isPainting || isAe;
          
          const handleClick = () => {
             if (isVits) onOpenVits();
             if (isPainting) onOpenGallery();
             if (isAe) onOpenAe();
          };
          
          return (
            <motion.div
              key={plan.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              onClick={isInteractive ? handleClick : undefined}
              className={`p-4 rounded-lg flex items-center justify-between group transition-all duration-300 glass-card ring-1 ${config.ring} ${
                isInteractive ? 'cursor-pointer hover:scale-105 hover:shadow-lg' : ''} ${
                isVits ? 'hover:bg-green-400/20 hover:border-green-400' : ''
              } ${
                isPainting ? 'hover:bg-purple-400/20 hover:border-purple-400' : ''
              } ${
                isAe ? 'hover:bg-indigo-400/20 hover:border-indigo-400' : ''
              }`}
            >
              <span className={`font-medium ${plan.status === PlanStatus.SHELVED ? 'text-slate-500' : 'text-slate-200'}`}>
                {plan.text}
              </span>
              <div className="flex items-center gap-2">
                {plan.status === PlanStatus.DOING && <span className="text-xs text-blue-400 font-mono">ing~</span>}
                {plan.status === PlanStatus.DONE && <span className="text-xs text-green-400 font-mono">GET</span>}
                {plan.status === PlanStatus.SHELVED && <span className="text-xs text-slate-600 font-mono">搁置</span>}
                <Icon className={`w-5 h-5 ${config.color}`} />
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};