import React from 'react';

const ROMAN: Record<number, string> = {
  0: '0', 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
  7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI', 12: 'XII',
  13: 'XIII', 14: 'XIV', 15: 'XV', 16: 'XVI', 17: 'XVII',
  18: 'XVIII', 19: 'XIX', 20: 'XX', 21: 'XXI',
};

interface TarotCardVisualProps {
  number: number;
  name: string;
  emoji: string;
  reversed?: boolean;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  keywords?: string[];
  onClick?: () => void;
}

export const TarotCardVisual: React.FC<TarotCardVisualProps> = ({
  number, name, emoji, reversed = false, faceDown = false, size = 'md', keywords, onClick,
}) => {
  const sizeClasses = {
    sm: 'w-24 h-36',
    md: 'w-36 h-52',
    lg: 'w-48 h-72',
  };

  const emojiSizes = {
    sm: 'text-2xl',
    md: 'text-4xl',
    lg: 'text-5xl',
  };

  if (faceDown) {
    return (
      <div
        onClick={onClick}
        className={`${sizeClasses[size]} rounded-xl relative overflow-hidden cursor-pointer transition-transform hover:scale-105 shrink-0`}
        style={{
          background: 'linear-gradient(135deg, #1a1a3e 0%, #0d0d2b 50%, #1a1a3e 100%)',
          border: '2px solid rgba(100, 100, 200, 0.4)',
          boxShadow: '0 4px 20px rgba(80, 60, 180, 0.3), inset 0 0 30px rgba(80, 60, 180, 0.1)',
        }}
      >
        {/* Card back pattern */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative">
            {/* Outer circle */}
            <div className="w-16 h-16 rounded-full border-2 border-indigo-500/40 flex items-center justify-center">
              {/* Inner circle */}
              <div className="w-10 h-10 rounded-full border border-indigo-400/30 flex items-center justify-center">
                <span className="text-xl opacity-60">✦</span>
              </div>
            </div>
            {/* Cross lines */}
            <div className="absolute top-0 left-1/2 -translate-x-px w-0.5 h-full bg-indigo-500/20" />
            <div className="absolute top-1/2 left-0 -translate-y-px w-full h-0.5 bg-indigo-500/20" />
          </div>
        </div>
        {/* Corner decorations */}
        <div className="absolute top-1.5 left-1.5 text-indigo-400/30 text-xs">✦</div>
        <div className="absolute top-1.5 right-1.5 text-indigo-400/30 text-xs">✦</div>
        <div className="absolute bottom-1.5 left-1.5 text-indigo-400/30 text-xs">✦</div>
        <div className="absolute bottom-1.5 right-1.5 text-indigo-400/30 text-xs">✦</div>
        {/* Border glow */}
        <div className="absolute inset-0 rounded-xl border border-indigo-400/10" />
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`${sizeClasses[size]} rounded-xl relative overflow-hidden cursor-pointer transition-all hover:scale-105 hover:shadow-lg shrink-0 flex flex-col`}
      style={{
        transform: reversed ? 'rotate(180deg)' : 'none',
        background: 'linear-gradient(180deg, #1e1b4b 0%, #0f0e2a 40%, #1a1145 100%)',
        border: '2px solid rgba(139, 92, 246, 0.5)',
        boxShadow: '0 4px 24px rgba(139, 92, 246, 0.2), inset 0 0 40px rgba(139, 92, 246, 0.05)',
      }}
    >
      {/* Top number */}
      <div className="text-center pt-2 pb-1">
        <span className="text-violet-400/70 text-xs font-serif tracking-widest">
          {ROMAN[number] || number}
        </span>
      </div>

      {/* Decorative line */}
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

      {/* Card name */}
      <div className="text-center py-1 px-2">
        <span className="text-violet-200 text-xs font-medium tracking-wider"
          style={{ transform: reversed ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>
          {name}
        </span>
      </div>

      {/* Main symbol area */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* Background glow */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-20 h-20 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, rgba(139,92,246,0.6) 0%, transparent 70%)' }} />
        </div>
        {/* Symbol */}
        <span className={`${emojiSizes[size]} relative z-10 drop-shadow-lg`}
          style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>
          {emoji}
        </span>
      </div>

      {/* Decorative line */}
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

      {/* Bottom keywords */}
      {size !== 'sm' && keywords && keywords.length > 0 && (
        <div className="text-center py-1.5 px-2"
          style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>
          <div className="flex flex-wrap justify-center gap-1">
            {keywords.slice(0, 3).map(k => (
              <span key={k} className="text-[9px] text-violet-400/60 px-1 py-0.5 bg-violet-500/10 rounded">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Bottom number */}
      <div className="text-center pb-2 pt-1">
        <span className="text-violet-400/70 text-xs font-serif tracking-widest"
          style={{ transform: reversed ? 'rotate(180deg)' : 'none', display: 'inline-block' }}>
          {ROMAN[number] || number}
        </span>
      </div>

      {/* Corner decorations */}
      <div className="absolute top-1 left-1 text-violet-500/20 text-[8px]"
        style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>✦</div>
      <div className="absolute top-1 right-1 text-violet-500/20 text-[8px]"
        style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>✦</div>
      <div className="absolute bottom-1 left-1 text-violet-500/20 text-[8px]"
        style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>✦</div>
      <div className="absolute bottom-1 right-1 text-violet-500/20 text-[8px]"
        style={{ transform: reversed ? 'rotate(180deg)' : 'none' }}>✦</div>

      {/* Reversed indicator */}
      {reversed && (
        <div className="absolute top-0 left-0 right-0 h-0.5 bg-red-500/40"
          style={{ transform: 'rotate(180deg)' }} />
      )}
    </div>
  );
};

// Card back component for face-down cards
export const TarotCardBack: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}> = ({ size = 'md', onClick }) => {
  return (
    <TarotCardVisual
      number={0} name="" emoji=""
      faceDown size={size} onClick={onClick}
    />
  );
};
