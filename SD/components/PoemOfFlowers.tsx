import React from 'react';
import { FLOWER_QUOTES } from '../constants';
import { Flower, Feather } from 'lucide-react';
import { motion } from 'framer-motion';

export const PoemOfFlowers: React.FC = () => {
  return (
    <div className="flex flex-col space-y-4 mt-8">
      <h2 className="text-2xl font-art text-pink-200 border-b border-pink-900/50 pb-2 mb-4 tracking-wider flex items-center gap-2">
        <Flower className="w-6 h-6 text-pink-400" />
        我与花之诗
      </h2>
      
      <div className="bg-slate-900/40 border border-pink-900/20 rounded-xl overflow-hidden backdrop-blur-sm">
        <div className="h-[1200px] overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-pink-900/50 scrollbar-track-transparent">
          {FLOWER_QUOTES.map((quote) => (
            <motion.div
              key={quote.id}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-20px" }}
              transition={{ delay: 0.05 }}
              className="relative pl-6 border-l-2 border-pink-500/20 group hover:border-pink-500/60 transition-colors duration-500"
            >
              <div className="absolute -left-[5px] top-0 w-2 h-2 rounded-full bg-pink-500/20 group-hover:bg-pink-400 transition-colors" />
              
              <div className="font-serif text-slate-300 whitespace-pre-line leading-relaxed tracking-wide group-hover:text-pink-100 transition-colors">
                {quote.content}
              </div>
              
              {quote.source && (
                <div className="mt-2 text-right">
                  <span className="text-xs text-pink-400/70 font-mono flex items-center justify-end gap-2">
                    <Feather className="w-3 h-3" />
                    {quote.source}
                  </span>
                </div>
              )}
            </motion.div>
          ))}
          
          <div className="text-center py-8">
             <div className="w-16 h-px bg-gradient-to-r from-transparent via-pink-500/50 to-transparent mx-auto" />
             <p className="text-xs text-slate-600 font-mono mt-2">END OF COLLECTION</p>
          </div>
        </div>
      </div>
    </div>
  );
};