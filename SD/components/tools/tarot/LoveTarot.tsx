import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';
import { ALL_CARDS } from './tarot-data';

interface LoveCard {
  number: number;
  name: string;
  emoji: string;
  suit?: string;
  keywords: string[];
  loveUpright: string;
  loveReversed: string;
}

const LOVE_CARDS: LoveCard[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由'], loveUpright: '你对爱情充满新鲜感和冒险精神，勇敢追求心中的感觉。', loveReversed: '在感情中过于冲动，需要更谨慎地对待关系。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能'], loveUpright: '你拥有吸引爱情的一切魅力，主动出击会带来好结果。', loveReversed: '可能存在虚假的表象，小心被花言巧语所迷惑。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘'], loveUpright: '倾听内心的声音，你的直觉会指引你找到真爱的方向。', loveReversed: '隐藏的感情或秘密正在影响关系，需要坦诚。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然'], loveUpright: '爱情中充满温暖与滋养，关系正在蓬勃发展。', loveReversed: '过度依赖或窒息式的爱让对方感到压力。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力'], loveUpright: '稳定而有安全感的感情，对方是值得依靠的伴侣。', loveReversed: '关系中存在控制欲或权力不平衡的问题。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育'], loveUpright: '传统而认真的感情态度，可能涉及承诺或婚姻。', loveReversed: '对传统关系模式的质疑，需要找到适合自己的方式。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐'], loveUpright: '深刻的爱情连接，灵魂伴侣的能量。面临重要的感情选择。', loveReversed: '感情中的不和谐或价值观冲突需要面对和解决。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心'], loveUpright: '以坚定的决心追求爱情，克服障碍后会获得胜利。', loveReversed: '感情中缺乏方向或被矛盾情绪所困扰。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量'], loveUpright: '用温柔和耐心经营感情，内在的力量会征服一切。', loveReversed: '在感情中缺乏自信，需要找回内心的力量。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧'], loveUpright: '需要独处的时间来思考感情，内省会带来清晰的答案。', loveReversed: '过度封闭自己，错过了身边可能出现的爱情。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇'], loveUpright: '命运正在转动，桃花运即将到来或关系进入新阶段。', loveReversed: '感情上的波折是暂时的，保持耐心等待转机。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果'], loveUpright: '公平而真诚的感情，双方都在付出和回报中找到平衡。', loveReversed: '感情中的不公正需要被正视，诚实面对自己的感受。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角'], loveUpright: '换个角度看感情问题，适当的退让会带来新的领悟。', loveReversed: '在感情中做了无谓的牺牲，需要重新评估。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生'], loveUpright: '旧的感情模式结束，为更深层的爱情腾出空间。', loveReversed: '害怕结束一段已经不再健康的关系。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和'], loveUpright: '和谐平衡的爱情关系，双方互相调适与包容。', loveReversed: '感情中失去了平衡，需要重新找到中间点。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质'], loveUpright: '强烈的激情与吸引力，但要分清爱情与执念。', loveReversed: '正在摆脱不健康的依恋或有毒的关系。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒'], loveUpright: '感情中的剧变虽然痛苦，但会带来必要的觉醒。', loveReversed: '回避关系中的根本问题，小问题终会积累成大问题。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静'], loveUpright: '对爱情保持希望和信心，美好的缘分正在靠近。', loveReversed: '对爱情失去信心，但请记住每段伤痛都会过去。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识'], loveUpright: '感情中有不确定和迷惑，信任直觉穿越迷雾。', loveReversed: '误会和困惑正在消散，真相会让关系更明朗。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力'], loveUpright: '爱情中充满快乐与温暖，关系正处于最美好的状态。', loveReversed: '暂时的小波折不会影响感情的整体走向。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤'], loveUpright: '感情上的觉醒与重生，可能是复合或更深层的承诺。', loveReversed: '逃避对感情的审视，不敢面对真实的内心。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就'], loveUpright: '爱情的圆满完成，找到了灵魂的归宿与完整的爱。', loveReversed: '感情还差最后一步，不要放弃，坚持就会圆满。' },
];

const POSITIONS = [
  { label: '你的状态', desc: '你在这段关系中的真实感受和状态' },
  { label: '对方状态', desc: '对方的感受、态度和可能的想法' },
  { label: '关系建议', desc: '宇宙给予这段关系的指引与建议' },
];

function getLoveCard(idx: number): LoveCard {
  if (idx < LOVE_CARDS.length) return LOVE_CARDS[idx];
  // Minor Arcana — generate generic love messages
  const base = ALL_CARDS[idx];
  return {
    number: base.number,
    name: base.name,
    emoji: base.emoji,
    suit: base.suit,
    keywords: base.keywords,
    loveUpright: `这张牌暗示在感情中需要关注${base.keywords[0] || '内心'}的能量。保持开放的心态。`,
    loveReversed: `在感情中可能遇到${base.keywords[0] || '相关'}方面的阻碍。需要耐心面对。`,
  };
}

function shuffleAndDraw(): { card: LoveCard; reversed: boolean }[] {
  const indices = Array.from({ length: ALL_CARDS.length }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, 3).map(idx => ({
    card: getLoveCard(idx),
    reversed: Math.random() > 0.5,
  }));
}

const LoveTarot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [cards, setCards] = useState<{ card: LoveCard; reversed: boolean }[] | null>(null);

  const drawCards = useCallback(() => {
    setCards(shuffleAndDraw());
  }, []);

  return (
    <div className="tarot-reading-surface space-y-6 text-base">
      <div className="text-center">
        <p className="text-pink-400/80 text-sm mb-1">💕 爱情专属占卜 💕</p>
        <p className="text-slate-400 text-xs mb-4">
          三张牌揭示你与TA的爱情密码
        </p>
        <button
          onClick={drawCards}
          className="px-6 py-3 bg-pink-500/20 border border-pink-500/30 text-pink-400 rounded-lg hover:bg-pink-500/30 transition-all text-sm font-medium"
        >
          {cards ? '💕 重新抽取' : '💕 开始爱情占卜'}
        </button>
      </div>

      {cards && (
        <>
          {/* Card visuals */}
          <div className="grid grid-cols-1 gap-5 justify-items-center sm:grid-cols-3">
            {cards.map((item, idx) => (
              <div key={idx} className="flex flex-col items-center gap-2">
                <div className="text-xs text-pink-400 font-medium">
                  {POSITIONS[idx].label}
                </div>
                <TarotCardVisual
                  number={item.card.number}
                  name={item.card.name}
                  emoji={item.card.emoji}
                  keywords={item.card.keywords}
                  reversed={item.reversed}
                  size="sm"
                />
              </div>
            ))}
          </div>

          {/* Interpretations */}
          <div className="space-y-2">
            {cards.map((item, idx) => (
              <div key={idx} className="bg-slate-800/50 border border-pink-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-pink-400 text-xs font-medium">{POSITIONS[idx].label}</span>
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
                  {item.reversed ? item.card.loveReversed : item.card.loveUpright}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default LoveTarot;
