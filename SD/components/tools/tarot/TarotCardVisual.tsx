import React, { useState } from 'react';

const ROMAN: Record<number, string> = {
  0: '0',
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
  10: 'X',
  11: 'XI',
  12: 'XII',
  13: 'XIII',
  14: 'XIV',
  15: 'XV',
  16: 'XVI',
  17: 'XVII',
  18: 'XVIII',
  19: 'XIX',
  20: 'XX',
  21: 'XXI',
};

const CARD_IMAGE_SLUGS: Record<number, string> = {
  0: 'fool',
  1: 'magician',
  2: 'high_priestess',
  3: 'empress',
  4: 'emperor',
  5: 'hierophant',
  6: 'lovers',
  7: 'chariot',
  8: 'strength',
  9: 'hermit',
  10: 'wheel_of_fortune',
  11: 'justice',
  12: 'hanged_man',
  13: 'death',
  14: 'temperance',
  15: 'devil',
  16: 'tower',
  17: 'star',
  18: 'moon',
  19: 'sun',
  20: 'judgement',
  21: 'world',
};

const MINOR_RANK_SLUGS: Record<number, string> = {
  1: 'ace', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
  11: 'page', 12: 'knight', 13: 'queen', 14: 'king',
};

interface TarotCardVisualProps {
  number: number;
  name: string;
  emoji: string;
  suit?: string;
  reversed?: boolean;
  faceDown?: boolean;
  size?: 'sm' | 'md' | 'lg';
  keywords?: string[];
  onClick?: () => void;
}

const SUIT_NAMES: Record<string, string> = {
  cups: 'cups',
  pentacles: 'pentacles',
  swords: 'swords',
  wands: 'wands',
};

const getCardImage = (number: number, suit?: string) => {
  // Major Arcana (0-21)
  const slug = CARD_IMAGE_SLUGS[number];
  if (slug) return `/assets/tarot/cards/tarot_${String(number).padStart(2, '0')}_${slug}.svg`;

  // Minor Arcana (22-77)
  if (suit && SUIT_NAMES[suit]) {
    const rankNum = ((number - 22) % 14) + 1;
    const rankSlug = MINOR_RANK_SLUGS[rankNum];
    if (rankSlug) return `/assets/tarot/cards/tarot_${suit}_${rankSlug}.svg`;
  }

  return null;
};

const sizeClasses = {
  sm: 'w-32 h-48',
  md: 'w-44 h-64',
  lg: 'w-64 h-96',
};

const emojiSizes = {
  sm: 'text-2xl',
  md: 'text-4xl',
  lg: 'text-5xl',
};

export const TarotCardVisual: React.FC<TarotCardVisualProps> = ({
  number,
  name,
  emoji,
  suit,
  reversed = false,
  faceDown = false,
  size = 'md',
  keywords,
  onClick,
}) => {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const imageSrc = faceDown ? '/assets/tarot/cards/tarot_back.svg' : getCardImage(number, suit);
  const previewTitle = faceDown ? '塔罗牌背面' : `${name || ROMAN[number] || number}${reversed ? ' · 逆位' : ''}`;
  const openPreview = () => {
    if (imageSrc) setIsPreviewOpen(true);
    onClick?.();
  };

  if (imageSrc) {
    return (
      <>
        <button
          type="button"
          onClick={openPreview}
          className={`${sizeClasses[size]} group relative shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-[#211713] p-0 text-left transition-all hover:scale-[1.035] hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-[#9a5a28]/25`}
          style={{ boxShadow: '0 18px 42px rgba(58, 34, 18, 0.28)' }}
          aria-label={`放大查看${previewTitle}`}
        >
          <img
            src={imageSrc}
            alt={faceDown ? 'Tarot card back' : `${name || ROMAN[number] || number} tarot card`}
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-[#f1dcc2]/20 transition group-hover:ring-[#f1dcc2]/55" />
          <div className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-[#f1dcc2]/45 bg-[#2f241b]/75 px-2 py-0.5 text-[10px] font-medium tracking-wider text-[#fff4e6] opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            放大
          </div>
          {reversed && !faceDown && (
            <div className="absolute left-2 top-2 rounded-full border border-red-300/60 bg-red-950/70 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-red-100 shadow-lg">
              逆位
            </div>
          )}
        </button>

        {isPreviewOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#241811]/80 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-label={previewTitle}
            onClick={() => setIsPreviewOpen(false)}
          >
            <div className="relative max-h-[92vh] w-full max-w-[min(78vw,520px)]" onClick={e => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setIsPreviewOpen(false)}
                className="absolute -right-2 -top-3 z-10 rounded-full border border-[#d8b58e] bg-[#fff4e6] px-3 py-1 text-sm font-semibold text-[#6f3714] shadow-lg hover:bg-[#f1dcc2]"
                aria-label="关闭放大卡牌"
              >
                关闭
              </button>
              <img
                src={imageSrc}
                alt={previewTitle}
                className="mx-auto max-h-[92vh] w-auto rounded-2xl border border-[#d8b58e]/70 object-contain shadow-2xl"
                draggable={false}
              />
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`${sizeClasses[size]} relative flex shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border-2 border-[#c79f72] bg-[#2f241b] transition-all hover:scale-105 hover:shadow-lg`}
      style={{ boxShadow: '0 18px 42px rgba(58, 34, 18, 0.28)' }}
    >
      <div className="pb-1 pt-2 text-center">
        <span className="font-serif text-xs tracking-widest text-[#d8b58e]/80">
          {ROMAN[number] || number}
        </span>
      </div>
      <div className="mx-3 h-px bg-gradient-to-r from-transparent via-[#d8b58e]/50 to-transparent" />
      <div className="px-2 py-1 text-center">
        <span className="text-xs font-medium tracking-wider text-[#fff4e6]">{name}</span>
      </div>
      <div className="relative flex flex-1 items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-20 w-20 rounded-full bg-[#d8b58e]/20" />
        </div>
        <span className={`${emojiSizes[size]} relative z-10 drop-shadow-lg`}>{emoji}</span>
      </div>
      {size !== 'sm' && keywords && keywords.length > 0 && (
        <div className="px-2 py-1.5 text-center">
          <div className="flex flex-wrap justify-center gap-1">
            {keywords.slice(0, 3).map(k => (
              <span key={k} className="rounded bg-[#9a5a28]/30 px-1 py-0.5 text-[9px] text-[#f1dcc2]">
                {k}
              </span>
            ))}
          </div>
        </div>
      )}
      {reversed && <div className="absolute left-2 top-2 rounded-full bg-red-950/70 px-2 py-0.5 text-[10px] text-red-100">逆位</div>}
    </div>
  );
};

export const TarotCardBack: React.FC<{
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
}> = ({ size = 'md', onClick }) => (
  <TarotCardVisual number={0} name="" emoji="" faceDown size={size} onClick={onClick} />
);
