import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';
import { ALL_CARDS, type TarotCard } from './tarot-data';

const POSITION_MEANINGS = [
  { label: '过去', desc: '影响当前局面的过去因素', icon: '⏪' },
  { label: '现在', desc: '当前正在经历的能量与状况', icon: '⏺️' },
  { label: '未来', desc: '可能的发展方向与结果', icon: '⏩' },
];

function shuffleAndDraw(): { card: TarotCard; reversed: boolean }[] {
  const indices = Array.from({ length: ALL_CARDS.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, 3).map(idx => ({
    card: ALL_CARDS[idx],
    reversed: Math.random() > 0.5,
  }));
}

const ThreeCardTarot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [cards, setCards] = useState<{ card: TarotCard; reversed: boolean }[] | null>(null);
  const [revealed, setRevealed] = useState<boolean[]>([false, false, false]);

  const drawCards = useCallback(() => {
    setCards(shuffleAndDraw());
    setRevealed([false, false, false]);
    // Stagger reveal
    setTimeout(() => setRevealed([true, false, false]), 500);
    setTimeout(() => setRevealed([true, true, false]), 1000);
    setTimeout(() => setRevealed([true, true, true]), 1500);
  }, []);

  return (
    <div className="tarot-reading-surface space-y-6 text-base">
      <div className="text-center">
        <p className="text-slate-400 text-sm mb-4">
          三张牌阵揭示你的过去、现在与未来
        </p>
        <button
          onClick={drawCards}
          className="px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium"
        >
          {cards ? '🔮 重新抽取' : '🔮 开始占卜'}
        </button>
      </div>

      {cards && (
        <>
          {/* Card visuals */}
          <div className="grid grid-cols-1 gap-5 justify-items-center sm:grid-cols-3">
            {cards.map((item, idx) => (
              <div key={idx} className="flex flex-col items-center gap-2">
                <div className="text-xs text-blue-400 font-medium">
                  {POSITION_MEANINGS[idx].icon} {POSITION_MEANINGS[idx].label}
                </div>
                <div style={{ perspective: '800px' }}>
                  <div className="transition-all duration-500" style={{
                    transform: revealed[idx] ? 'rotateY(0deg)' : 'rotateY(90deg)',
                    opacity: revealed[idx] ? 1 : 0,
                  }}>
                    <TarotCardVisual
                      number={item.card.number}
                      name={item.card.name}
                      emoji={item.card.emoji}
                      keywords={item.card.keywords}
                      reversed={item.reversed}
                      size="sm"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Interpretations */}
          <div className="space-y-2">
            {cards.map((item, idx) => (
              revealed[idx] && (
                <div key={idx} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-blue-400 text-xs font-medium">{POSITION_MEANINGS[idx].label}</span>
                    <span className="text-slate-600 text-xs">·</span>
                    <span className="text-slate-300 text-xs font-medium">{item.card.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      item.reversed
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                        : 'bg-green-500/20 text-green-400 border border-green-500/30'
                    }`}>
                      {item.reversed ? '逆位' : '正位'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">
                    {item.reversed ? item.card.reversed : item.card.upright}
                  </p>
                </div>
              )
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default ThreeCardTarot;
