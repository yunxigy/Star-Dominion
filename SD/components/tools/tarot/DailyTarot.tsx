import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';
import { ALL_CARDS, type TarotCard } from './tarot-data';

function getDailySeed(): number {
  const now = new Date();
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function seededRandom(seed: number): number {
  let x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const DailyTarot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [card, setCard] = useState<{ data: TarotCard; reversed: boolean } | null>(null);
  const [flipped, setFlipped] = useState(false);

  const drawCard = useCallback(() => {
    const seed = getDailySeed();
    const cardIndex = Math.floor(seededRandom(seed) * ALL_CARDS.length);
    const isReversed = seededRandom(seed + 1) > 0.5;
    setCard({ data: ALL_CARDS[cardIndex], reversed: isReversed });
    setFlipped(false);
    // Auto-flip after a short delay
    setTimeout(() => setFlipped(true), 600);
  }, []);

  return (
    <div className="tarot-reading-surface space-y-6 text-base">
      <div className="text-center">
        <p className="text-slate-400 text-sm mb-4">
          每天抽取一张塔罗牌，获取今日的指引与启示
        </p>
        <button
          onClick={drawCard}
          className="px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium"
        >
          {card ? '🔮 重新抽取' : '🔮 抽取今日塔罗'}
        </button>
      </div>

      {card && (
        <div className="space-y-4">
          {/* Card visual */}
          <div className="flex justify-center" style={{ perspective: '1000px' }}>
            <div className="transition-all duration-700" style={{
              transform: flipped ? 'rotateY(0deg)' : 'rotateY(90deg)',
              opacity: flipped ? 1 : 0,
            }}>
              <TarotCardVisual
                number={card.data.number}
                name={card.data.name}
                emoji={card.data.emoji}
                suit={card.data.suit}
                keywords={card.data.keywords}
                reversed={card.reversed}
                size="lg"
              />
            </div>
          </div>

          {/* Card info */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4">
            <div className="text-center mb-3">
              <h3 className="text-xl font-bold text-blue-400 mb-1">{card.data.name}</h3>
              <span className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                card.reversed
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}>
                {card.reversed ? '逆位' : '正位'}
              </span>
            </div>

            <div className="space-y-3">
              <div className="bg-slate-700/30 rounded-lg p-3">
                <p className="text-xs text-slate-500 mb-1">关键词</p>
                <p className="text-sm text-slate-300">
                  {card.reversed ? card.data.reversed : card.data.upright}
                </p>
              </div>
              <div className="bg-slate-700/30 rounded-lg p-3">
                <p className="text-xs text-blue-400/80 mb-1">今日启示</p>
                <p className="text-sm text-slate-300 leading-relaxed">
                  {card.reversed ? card.data.reversedMessage : card.data.uprightMessage}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DailyTarot;
