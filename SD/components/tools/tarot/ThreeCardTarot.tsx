import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';

interface TarotCard {
  number: number;
  name: string;
  emoji: string;
  keywords: string[];
  upright: string;
  reversed: string;
}

const MAJOR_ARCANA: TarotCard[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由'], upright: '新开始、冒险精神、自由奔放，勇敢踏入未知领域', reversed: '鲁莽行事、不计后果、盲目冒进，需要三思而后行' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能'], upright: '创造力充沛、意志坚定、技能出众，万事俱备', reversed: '能力未被善用、投机取巧、欺骗与操控' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘'], upright: '直觉敏锐、潜意识的智慧、神秘的知识', reversed: '忽视直觉、过于表面化、隐藏的秘密' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然'], upright: '丰盛与美好、母性关怀、自然之美、创造力', reversed: '过度依赖、窒息的关爱、创造力受阻' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力'], upright: '权威与领导、建立秩序、坚定的结构', reversed: '独裁专制、僵化固执、过度控制' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育'], upright: '传统智慧、精神指引、信仰与教育', reversed: '叛逆传统、教条主义、盲从权威' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐'], upright: '爱情与和谐、重要的选择、价值观统一', reversed: '关系不和谐、价值观冲突、面临艰难选择' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心'], upright: '意志坚定、取得胜利、克服障碍', reversed: '失去方向、挫败感、缺乏自制力' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量'], upright: '内心强大、温柔的力量、耐心与勇气', reversed: '自我怀疑、内心脆弱、缺乏信心' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧'], upright: '深度内省、独处的智慧、寻求真理', reversed: '过度孤立、逃避现实、固执己见' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇'], upright: '命运转折、新的机遇、因果循环', reversed: '抗拒变化、运气低迷、错失良机' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果'], upright: '公平公正、真相大白、因果报应', reversed: '不公正待遇、逃避责任、偏见与不公' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角'], upright: '换个角度看、适时放手、牺牲与奉献', reversed: '无谓的牺牲、拖延不决、固执不变' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生'], upright: '结束与重生、深刻转变、放下过去', reversed: '抗拒结束、恐惧改变、停滞不前' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和'], upright: '平衡与和谐、耐心调和、中庸之道', reversed: '失去平衡、过度极端、缺乏耐心' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质'], upright: '物质束缚、欲望执念、认清枷锁', reversed: '打破束缚、解脱自由、觉醒与释放' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒'], upright: '突然的改变、打破旧有、觉醒的冲击', reversed: '避免灾难、延迟变革、恐惧改变' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静'], upright: '充满希望、灵感涌现、内心宁静', reversed: '失去信心、创意枯竭、暂时的绝望' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识'], upright: '幻象与迷惑、面对恐惧、潜意识信息', reversed: '恐惧消散、真相显现、走出迷雾' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力'], upright: '快乐成功、充满活力、阳光普照', reversed: '暂时阴霾、过度乐观、延迟的快乐' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤'], upright: '灵魂觉醒、重获新生、内心的召唤', reversed: '自我怀疑、拒绝审视、逃避觉醒' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就'], upright: '圆满完成、整合成就、旅程的终点', reversed: '尚未完成、缺乏闭合、未竟之事' },
];

const POSITION_MEANINGS = [
  { label: '过去', desc: '影响当前局面的过去因素', icon: '⏪' },
  { label: '现在', desc: '当前正在经历的能量与状况', icon: '⏺️' },
  { label: '未来', desc: '可能的发展方向与结果', icon: '⏩' },
];

function shuffleAndDraw(): { card: TarotCard; reversed: boolean }[] {
  const indices = Array.from({ length: 22 }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, 3).map(idx => ({
    card: MAJOR_ARCANA[idx],
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
