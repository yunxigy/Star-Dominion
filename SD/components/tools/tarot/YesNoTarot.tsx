import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';
import { ALL_CARDS } from './tarot-data';

interface YesNoCard {
  number: number;
  name: string;
  emoji: string;
  suit?: string;
  keywords: string[];
  answer: 'yes' | 'no' | 'maybe';
  uprightYes: string;
  uprightNo: string;
  uprightMaybe: string;
  reversedYes: string;
  reversedNo: string;
  reversedMaybe: string;
}

const YES_NO_CARDS: YesNoCard[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险'], answer: 'maybe', uprightYes: '大胆去做！但请保持警觉，享受过程中的每一刻。', uprightNo: '也许现在不是最佳时机，但你的冒险精神值得肯定。', uprightMaybe: '答案取决于你是否准备好迎接未知，问问自己的内心。', reversedYes: '虽然结果可能是肯定的，但请三思而后行。', reversedNo: '现在确实不是好时机，避免冲动决定。', reversedMaybe: '先解决内心的犹豫，答案自会浮现。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力'], answer: 'yes', uprightYes: '你拥有实现这个愿望的一切条件，自信地去做吧！', uprightNo: '虽然这次不行，但你的能力毋庸置疑。', uprightMaybe: '关键在于你是否愿意全力以赴去实现它。', reversedYes: '结果可能是肯定的，但要小心不要走捷径。', reversedNo: '时机未到，先提升自己的能力。', reversedMaybe: '诚实面对自己是否在逃避什么。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识'], answer: 'maybe', uprightYes: '答案是肯定的，但需要耐心等待时机成熟。', uprightNo: '表面上的否定可能隐藏着更深层的智慧。', uprightMaybe: '你已经知道答案了，信任你的直觉。', reversedYes: '看起来是肯定的，但要注意隐藏的信息。', reversedNo: '有些事情还没有完全显露，耐心等待。', reversedMaybe: '不要急于求成，让真相自然浮现。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性'], answer: 'yes', uprightYes: '丰盛的能量支持你，去做会带来美好的结果。', uprightNo: '虽然这次不行，但你的付出终会开花结果。', uprightMaybe: '答案取决于你是否愿意用爱和耐心去培育。', reversedYes: '可能会成功，但要注意不要过度投入。', reversedNo: '先照顾好自己，答案会随之而来。', reversedMaybe: '审视是否有依赖心理影响了你的判断。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构'], answer: 'yes', uprightYes: '坚定的决心会带来肯定的结果，勇往直前。', uprightNo: '需要建立更稳固的基础才能实现。', uprightMaybe: '制定明确的计划，答案会变得清晰。', reversedYes: '可能会成功，但要避免过于强势。', reversedNo: '控制欲可能阻碍了真正的进展。', reversedMaybe: '放松控制，让事情自然发展。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰'], answer: 'maybe', uprightYes: '遵循正确的道路，结果会是肯定的。', uprightNo: '也许需要寻找不同的指引或方向。', uprightMaybe: '寻求智者的建议会帮助你做出决定。', reversedYes: '可以做，但要用自己的方式。', reversedNo: '不必被传统束缚，但也要尊重规则。', reversedMaybe: '打破常规思维，答案可能出人意料。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择'], answer: 'yes', uprightYes: '爱的能量支持你，跟随内心的选择。', uprightNo: '也许需要重新审视你真正想要的是什么。', uprightMaybe: '这是一个关于选择的问题，没有绝对的对错。', reversedYes: '可能会实现，但要审视内心的真实想法。', reversedNo: '存在价值观上的冲突需要先解决。', reversedMaybe: '先厘清自己真正的感受再做决定。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志'], answer: 'yes', uprightYes: '以坚定的意志力前进，胜利属于你！', uprightNo: '也许需要调整方向再出发。', uprightMaybe: '答案取决于你是否能保持专注和决心。', reversedYes: '有可能成功，但要先找到正确的方向。', reversedNo: '缺乏方向感，先确定目标。', reversedMaybe: '重新聚焦，答案会在清晰中显现。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '内在力量'], answer: 'yes', uprightYes: '你有内在的力量去实现它，温柔而坚定地去做。', uprightNo: '需要更多的耐心和内在力量。', uprightMaybe: '相信自己的能力，答案会随之而来。', reversedYes: '可能会成功，但要先建立自信。', reversedNo: '自我怀疑在阻碍你，先找回力量。', reversedMaybe: '内心的恐惧遮蔽了答案，面对它。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '智慧'], answer: 'maybe', uprightYes: '独处思考后，你会发现答案是肯定的。', uprightNo: '也许你需要先退一步，看清全局。', uprightMaybe: '答案在你内心深处，安静下来倾听。', reversedYes: '不要过度分析，有时候答案很简单。', reversedNo: '也许你只是在逃避做出决定。', reversedMaybe: '走出独处，与他人交流会有帮助。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变'], answer: 'maybe', uprightYes: '命运之轮向你倾斜，好运即将到来。', uprightNo: '也许这次不是最好的时机，但机会还会再来。', uprightMaybe: '命运正在转动，保持开放的心态等待。', reversedYes: '虽然目前低迷，但终会转向积极。', reversedNo: '运气暂时不在你这边，保持耐心。', reversedMaybe: '低谷期终会过去，等待转机。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相'], answer: 'yes', uprightYes: '公正的结果会降临，你的付出会得到回报。', uprightNo: '也许需要先做出一些调整才能得到公正的结果。', uprightMaybe: '诚实地审视自己，答案会变得明朗。', reversedYes: '可能会实现，但过程可能不太公平。', reversedNo: '有些不公正的因素在影响结果。', reversedMaybe: '先解决不公正的问题，答案自会浮现。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '新视角'], answer: 'maybe', uprightYes: '换个角度看，答案其实是肯定的。', uprightNo: '也许你需要先放手一些东西。', uprightMaybe: '暂停下来，从不同角度审视这个问题。', reversedYes: '也许可以，但要考虑是否值得。', reversedNo: '你在做无谓的挣扎，适时放手。', reversedMaybe: '不要再拖延，做出决定本身比答案更重要。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '重生'], answer: 'no', uprightYes: '旧的结束意味着新的肯定，重生带来新机遇。', uprightNo: '一个阶段需要结束，才能开启新的可能。', uprightMaybe: '转变正在发生，答案会在转变后揭晓。', reversedYes: '有可能，但要先放下旧有的包袱。', reversedNo: '抗拒结束只会延长痛苦。', reversedMaybe: '害怕改变遮蔽了答案，勇敢面对。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '调和'], answer: 'maybe', uprightYes: '找到平衡后，结果会是积极的。', uprightNo: '也许需要更多的耐心和调和。', uprightMaybe: '答案在于找到适当的平衡点。', reversedYes: '可能会成功，但过程可能失衡。', reversedNo: '失衡的状态不利于做出正确决定。', reversedMaybe: '先恢复生活的平衡，答案会更清晰。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望'], answer: 'no', uprightYes: '也许可以实现，但要审视动机是否纯正。', uprightNo: '欲望和执念可能在误导你，谨慎行事。', uprightMaybe: '分清真正的需要和虚假的欲望。', reversedYes: '摆脱束缚后，答案会是肯定的。', reversedNo: '先挣脱束缚，再重新审视这个问题。', reversedMaybe: '觉醒的过程会带来清晰的答案。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '觉醒'], answer: 'no', uprightYes: '虽然过程可能剧变，但重建后会更好。', uprightNo: '剧烈的变化可能会改变一切，做好准备。', uprightMaybe: '变革正在发生，答案会在风暴后显现。', reversedYes: '也许可以避免最坏的结果。', reversedNo: '回避问题不会让问题消失。', reversedMaybe: '延迟的变革终会到来，做好准备。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感'], answer: 'yes', uprightYes: '充满希望的答案！保持信心，美好正在到来。', uprightNo: '虽然现在看不到，但希望从未消失。', uprightMaybe: '答案是充满希望的，保持乐观。', reversedYes: '可能会实现，但要先重拾信心。', reversedNo: '暂时的失望不代表永远的否定。', reversedMaybe: '重新点燃内心的希望之火。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧'], answer: 'maybe', uprightYes: '穿越迷雾后，答案可能是肯定的。', uprightNo: '目前的迷惑让你无法看清真正的答案。', uprightMaybe: '现在不是做决定的好时机，等待迷雾散去。', reversedYes: '真相正在显现，可能会是好消息。', reversedNo: '迷雾正在散去，答案会更清晰。', reversedMaybe: '恐惧在干扰你的判断，冷静下来。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功'], answer: 'yes', uprightYes: '阳光灿烂的肯定答案！快乐地去做吧！', uprightNo: '虽然这次不行，但你的光芒不会被掩盖。', uprightMaybe: '积极的能量环绕着你，答案倾向肯定。', reversedYes: '可能会成功，只是过程没有那么完美。', reversedNo: '暂时的小挫折，不代表永远不行。', reversedMaybe: '保持乐观，答案会是积极的。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '召唤'], answer: 'yes', uprightYes: '觉醒的力量带来肯定的答案，听从内心的召唤。', uprightNo: '也许需要更多的自我审视才能找到答案。', uprightMaybe: '内心的觉醒会带来清晰的答案。', reversedYes: '也许可以，但要先面对内心的真相。', reversedNo: '逃避审视不会带来好结果。', reversedMaybe: '勇敢面对自己，答案会自然浮现。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '成就'], answer: 'yes', uprightYes: '圆满的能量支持你，肯定的答案正在到来。', uprightNo: '也许还有最后一步需要完成。', uprightMaybe: '答案接近圆满，再坚持一下。', reversedYes: '快要实现了，不要放弃。', reversedNo: '也许差最后一步，坚持就会成功。', reversedMaybe: '完成的时刻即将到来，保持耐心。' },
];

const YesNoTarot: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [question, setQuestion] = useState('');
  const [card, setCard] = useState<{ data: YesNoCard; reversed: boolean } | null>(null);
  const [revealed, setRevealed] = useState(false);

  const getYesNoCard = (idx: number): YesNoCard => {
    if (idx < YES_NO_CARDS.length) return YES_NO_CARDS[idx];
    const base = ALL_CARDS[idx];
    const answers: ('yes' | 'no' | 'maybe')[] = ['yes', 'no', 'maybe'];
    const answer = answers[idx % 3];
    return {
      number: base.number,
      name: base.name,
      emoji: base.emoji,
      suit: base.suit,
      keywords: base.keywords,
      answer,
      uprightYes: `这张牌的能量倾向于肯定。${base.keywords[0] || ''}的力量在支持你。`,
      uprightNo: `现在可能不是最佳时机。关注${base.keywords[0] || '内心'}的指引。`,
      uprightMaybe: `答案还不确定。${base.keywords[0] || ''}的能量需要更多时间显现。`,
      reversedYes: `可能实现，但需要注意${base.keywords[0] || '相关'}方面的问题。`,
      reversedNo: `目前的阻碍较多，建议先调整再行动。`,
      reversedMaybe: `答案模糊，需要更深入的思考和准备。`,
    };
  };

  const drawCard = useCallback(() => {
    if (!question.trim()) return;
    const idx = Math.floor(Math.random() * ALL_CARDS.length);
    const isReversed = Math.random() > 0.5;
    setCard({ data: getYesNoCard(idx), reversed: isReversed });
    setRevealed(false);
    setTimeout(() => setRevealed(true), 600);
  }, [question]);

  const getAnswerDisplay = (answer: 'yes' | 'no' | 'maybe') => {
    switch (answer) {
      case 'yes': return { text: '是', color: 'text-green-400', bg: 'bg-green-500/20 border-green-500/30' };
      case 'no': return { text: '否', color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/30' };
      case 'maybe': return { text: '或许', color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/30' };
    }
  };

  const getInterpretation = (data: YesNoCard, reversed: boolean) => {
    switch (data.answer) {
      case 'yes': return reversed ? data.reversedYes : data.uprightYes;
      case 'no': return reversed ? data.reversedNo : data.uprightNo;
      case 'maybe': return reversed ? data.reversedMaybe : data.uprightMaybe;
    }
  };

  return (
    <div className="tarot-reading-surface space-y-6 text-base">
      <div className="text-center">
        <p className="text-slate-400 text-sm mb-4">
          心中想一个问题，塔罗牌会给你指引
        </p>
      </div>

      <div className="space-y-3">
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="输入你的问题..."
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
        />
        <button
          onClick={drawCard}
          disabled={!question.trim()}
          className="w-full px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          🔮 揭示答案
        </button>
      </div>

      {card && (
        <div className={`space-y-4 transition-all duration-500 ${revealed ? 'opacity-100' : 'opacity-0'}`}>
          {/* Visual card */}
          <div className="flex justify-center" style={{ perspective: '1000px' }}>
            <div className="transition-all duration-700" style={{
              transform: revealed ? 'rotateY(0deg)' : 'rotateY(90deg)',
              opacity: revealed ? 1 : 0,
            }}>
              <TarotCardVisual
                number={card.data.number}
                name={card.data.name}
                emoji={card.data.emoji}
                keywords={card.data.keywords}
                reversed={card.reversed}
                size="lg"
              />
            </div>
          </div>

          {/* Answer */}
          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-center">
            <h3 className="text-lg font-bold text-blue-400 mb-2">{card.data.name}</h3>
            <div className="flex items-center justify-center gap-2 mb-3">
              <span className={`text-xs px-2 py-0.5 rounded-full ${
                card.reversed
                  ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                  : 'bg-green-500/20 text-green-400 border border-green-500/30'
              }`}>
                {card.reversed ? '逆位' : '正位'}
              </span>
              {(() => {
                const display = getAnswerDisplay(card.data.answer);
                return (
                  <span className={`px-3 py-1 rounded-full text-sm font-bold border ${display.bg} ${display.color}`}>
                    {display.text}
                  </span>
                );
              })()}
            </div>

            <div className="bg-slate-700/30 rounded-lg p-3">
              <p className="text-xs text-blue-400/80 mb-1">牌的指引</p>
              <p className="text-sm text-slate-300 leading-relaxed">
                {getInterpretation(card.data, card.reversed)}
              </p>
            </div>

            <p className="text-xs text-slate-500 text-center mt-3">
              你的问题：{question}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default YesNoTarot;
