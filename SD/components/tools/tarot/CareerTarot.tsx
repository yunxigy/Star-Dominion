import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';

interface CareerCard {
  number: number;
  name: string;
  emoji: string;
  keywords: string[];
  careerUpright: string;
  careerReversed: string;
}

const CAREER_CARDS: CareerCard[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由'], careerUpright: '新的职业机会正在敲门，勇敢尝试不同的方向。', careerReversed: '盲目跳槽或冒险投资需要谨慎，三思而后行。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能'], careerUpright: '你拥有完成目标所需的全部技能，自信地展现自己。', careerReversed: '能力未被充分利用，或在工作中存在欺骗行为。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘'], careerUpright: '相信你的职业直觉，隐藏的机会需要耐心等待才能浮现。', careerReversed: '忽视了职场中的重要信号，需要更深入地了解情况。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然'], careerUpright: '创意和感性在工作中大放异彩，项目正在丰收期。', careerReversed: '工作与生活失衡，过度投入或创造力枯竭。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力'], careerUpright: '领导力和组织能力受到认可，适合承担管理角色。', careerReversed: '职场中的权力斗争或管理风格过于强硬。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育'], careerUpright: '遵循行业规范和传统路径会带来稳定发展，导师的指引很重要。', careerReversed: '对传统职业路径的质疑，可能需要创新突破。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐'], careerUpright: '面临重要的职业选择，跟随内心做出决定。', careerReversed: '职业方向与个人价值观存在冲突，需要重新审视。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心'], careerUpright: '坚定的意志力推动事业前进，胜利就在眼前。', careerReversed: '职业方向迷失，需要重新聚焦目标。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量'], careerUpright: '以耐心和毅力克服职场挑战，内在力量是你的优势。', careerReversed: '在工作中缺乏自信，面对挑战时感到力不从心。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧'], careerUpright: '独立思考和深度研究会带来职业上的突破。', careerReversed: '过度独来独往，错失了团队合作的机会。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇'], careerUpright: '职业生涯的重大转折点，新的机遇正在到来。', careerReversed: '职业上的低迷期是暂时的，保持耐心。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果'], careerUpright: '公平的评价和回报，你的努力终将得到认可。', careerReversed: '职场中的不公正待遇需要被正视和解决。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角'], careerUpright: '换个角度思考职业问题，暂时的停滞会带来新视角。', careerReversed: '在不喜欢的工作中消耗自己，需要做出改变。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生'], careerUpright: '职业生涯的重大转变，旧的结束是新的开始。', careerReversed: '抗拒必要的职业转变，害怕离开舒适区。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和'], careerUpright: '在工作中找到平衡与和谐，团队协作顺畅。', careerReversed: '工作负荷失衡，需要重新分配时间和精力。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质'], careerUpright: '警惕金钱和权力的诱惑，不要为利益牺牲原则。', careerReversed: '正在摆脱不满意的工作环境或不良的职场关系。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒'], careerUpright: '突然的职场变故虽然冲击，但会带来重建的机会。', careerReversed: '避免了一场职业危机，但仍需警惕潜在问题。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静'], careerUpright: '对职业前景保持信心，灵感和希望正在指引方向。', careerReversed: '职业信心受挫，重新连接内心的热情和梦想。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识'], careerUpright: '职场中存在不确定因素，信任直觉做出判断。', careerReversed: '职场迷雾正在散去，真相会指引正确方向。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力'], careerUpright: '事业蒸蒸日上，获得认可和成功的时刻。', careerReversed: '暂时的困难不会影响事业的长期发展。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤'], careerUpright: '职业生涯的觉醒时刻，重新审视使命和方向。', careerReversed: '逃避对职业方向的深层思考，需要勇敢面对。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就'], careerUpright: '职业目标的圆满完成，收获成就与满足。', careerReversed: '事业上还差最后的冲刺，不要半途而废。' },
];

const POSITIONS = [
  { label: '当前处境', desc: '你目前的事业状态与环境' },
  { label: '面临挑战', desc: '需要克服的障碍与考验' },
  { label: '行动建议', desc: '宇宙给予的事业指引' },
];

function shuffleAndDraw(): { card: CareerCard; reversed: boolean }[] {
  const indices = Array.from({ length: 22 }, (_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices.slice(0, 3).map(idx => ({
    card: CAREER_CARDS[idx],
    reversed: Math.random() > 0.5,
  }));
}

const CareerTarot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [cards, setCards] = useState<{ card: CareerCard; reversed: boolean }[] | null>(null);

  const drawCards = useCallback(() => {
    setCards(shuffleAndDraw());
  }, []);

  return (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-blue-400 text-sm mb-1">💼 事业专属占卜</p>
        <p className="text-slate-400 text-xs mb-4">
          三张牌为你揭示事业方向与行动指引
        </p>
        <button
          onClick={drawCards}
          className="px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium"
        >
          {cards ? '🔮 重新抽取' : '🔮 开始事业占卜'}
        </button>
      </div>

      {cards && (
        <>
          {/* Card visuals */}
          <div className="grid grid-cols-3 gap-3 justify-items-center">
            {cards.map((item, idx) => (
              <div key={idx} className="flex flex-col items-center gap-2">
                <div className="text-xs text-blue-400 font-medium">
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
              <div key={idx} className="bg-slate-800/50 border border-blue-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-blue-400 text-xs font-medium">{POSITIONS[idx].label}</span>
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
                  {item.reversed ? item.card.careerReversed : item.card.careerUpright}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default CareerTarot;
