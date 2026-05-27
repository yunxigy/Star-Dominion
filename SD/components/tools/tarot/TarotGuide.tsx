import React, { useState, useMemo } from 'react';

interface TarotCardInfo {
  number: number;
  name: string;
  emoji: string;
  keywords: string[];
  upright: string;
  reversed: string;
}

const ALL_CARDS: TarotCardInfo[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由', '天真', '潜力'], upright: '愚者代表新的开始和无限的可能性。它象征着天真无邪的冒险精神，鼓励你以开放的心态踏上未知的旅程。信任宇宙的安排，勇敢地迈出第一步。', reversed: '逆位的愚者提醒你注意冲动和鲁莽。在做决定之前需要更多的思考和规划，避免不计后果的行为。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能', '自信', '行动'], upright: '魔术师象征着将想法变为现实的能力。你拥有实现目标所需的一切资源和技能，集中精力，自信地施展你的才华。', reversed: '逆位的魔术师警告能力被滥用或存在欺骗。可能存在投机取巧的行为，需要回归诚实和踏实。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘', '智慧', '内在'], upright: '女祭司代表深层的直觉和潜意识的智慧。倾听内心的声音，那些隐藏的真相会在安静中向你显现。', reversed: '逆位的女祭司暗示你忽视了直觉的警告。表面化的处理方式可能会让你错过重要的信息。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然', '创造', '美'], upright: '皇后象征丰盛、美丽和创造力。享受生活的美好，用爱和关怀滋养自己和他人。', reversed: '逆位的皇后可能表示过度保护或依赖。需要在给予和接受之间找到平衡。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力', '稳定', '规则'], upright: '皇帝代表权威和秩序。建立清晰的结构和规则，以坚定的领导力指引方向。', reversed: '逆位的皇帝警告专制和僵化。过于强硬的控制可能会适得其反。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育', '指引', '精神'], upright: '教皇象征传统智慧和精神指引。遵循既定的规则和信仰体系会带来心灵的安宁。', reversed: '逆位的教皇暗示对传统的质疑。有时候需要打破常规，寻找适合自己的道路。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐', '关系', '价值观'], upright: '恋人代表深层的爱情连接和重要的选择。在做决定时，跟随内心最真实的声音。', reversed: '逆位的恋人暗示关系中的不和谐或价值观冲突。需要坦诚沟通来化解分歧。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心', '克服', '前进'], upright: '战车象征通过坚定意志取得胜利。克服障碍，勇往直前，胜利就在前方。', reversed: '逆位的战车表示失去方向或控制。需要重新调整目标和策略。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量', '温柔', '控制'], upright: '力量代表内在的勇气和温柔的力量。用耐心和坚定面对挑战，真正的力量来自内心。', reversed: '逆位的力量暗示自我怀疑和脆弱。需要重新建立内在的自信和力量。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧', '指引', '寻找'], upright: '隐者代表深度的内省和独处的智慧。远离喧嚣，向内探索，你将找到真正的答案。', reversed: '逆位的隐者警告过度孤立。独处虽好，但也需要与外界保持连接。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇', '循环', '运气'], upright: '命运之轮象征生命中的重大转变和机遇。变化是永恒的，顺应潮流，好运即将到来。', reversed: '逆位的命运之轮暗示运气暂时低迷。但低谷只是暂时的，保持耐心。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果', '平衡', '责任'], upright: '正义代表公平和真相。诚实地面对自己和他人，善因结善果，公正终将到来。', reversed: '逆位的正义暗示不公正或逃避责任。需要正视问题，承担应有的责任。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角', '等待', '领悟'], upright: '倒吊人代表换个角度看问题。适当的放手和牺牲会带来意想不到的领悟和收获。', reversed: '逆位的倒吊人警告无谓的牺牲和拖延。适时做出改变，不要固守不变。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生', '放下', '新生'], upright: '死神象征一个阶段的结束和新阶段的开始。拥抱转变，放下旧的，迎来重生。', reversed: '逆位的死神暗示抗拒必要的改变。接受结束是新开始的前提。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和', '中庸', '和谐'], upright: '节制代表在各方面找到平衡。耐心调和不同的元素，中庸之道带来和谐。', reversed: '逆位的节制暗示生活失衡。重新审视优先级，找到健康的中间点。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质', '执念', '诱惑'], upright: '恶魔象征物质欲望和不良习惯的束缚。认清哪些是真正的需求，哪些是虚假的诱惑。', reversed: '逆位的恶魔代表正在摆脱束缚。这是觉醒和解放的时刻。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒', '破坏', '重建'], upright: '塔象征突如其来的变化和觉醒。在废墟上重建更坚固的基础。', reversed: '逆位的塔暗示延迟的变革。回避不会让问题消失，终需面对。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静', '治愈', '信念'], upright: '星星代表希望和灵感。保持信念，星光照亮前路，美好正在到来。', reversed: '逆位的星星暗示暂时失去信心。但星光从未消失，重新点燃希望。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识', '迷惑', '直觉'], upright: '月亮象征幻象和潜意识。穿越迷雾，信任直觉，不要被恐惧所迷惑。', reversed: '逆位的月亮暗示困惑正在消散。真相逐渐明朗，恐惧正在退去。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力', '光明', '温暖'], upright: '太阳象征快乐、成功和活力。阳光灿烂，享受这份美好，分享你的光芒。', reversed: '逆位的太阳暗示暂时的阴霾。但阳光终会普照，保持乐观。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤', '审视', '救赎'], upright: '审判代表灵魂的觉醒和重生。审视过去，接受评判，迎来更高层次的觉醒。', reversed: '逆位的审判暗示逃避自我审视。勇敢面对内心的声音。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就', '圆满', '旅程'], upright: '世界象征一个重要的循环圆满完成。庆祝成就，整合所学，为新旅程做好准备。', reversed: '逆位的世界暗示尚未完成。审视还有什么需要收尾，不要半途而废。' },
];

const TarotGuide: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [search, setSearch] = useState('');
  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  const filteredCards = useMemo(() => {
    if (!search.trim()) return ALL_CARDS;
    const q = search.toLowerCase();
    return ALL_CARDS.filter(card =>
      card.name.includes(q) ||
      card.keywords.some(k => k.includes(q))
    );
  }, [search]);

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">
          22张大阿卡纳牌义详解，点击卡片查看详情
        </p>
      </div>

      <input
        type="text"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="搜索牌名或关键词..."
        className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
      />

      <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
        {filteredCards.map(card => (
          <div
            key={card.number}
            className="bg-slate-800/50 border border-slate-700 rounded-lg overflow-hidden"
          >
            <button
              onClick={() => setExpandedCard(expandedCard === card.number ? null : card.number)}
              className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-700/30 transition-colors"
            >
              <span className="text-2xl">{card.emoji}</span>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-blue-400 text-xs font-mono">{card.number}</span>
                  <span className="text-sm font-medium text-slate-200">{card.name}</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {card.keywords.slice(0, 3).map(k => (
                    <span key={k} className="text-xs px-1.5 py-0.5 bg-slate-700/50 text-slate-400 rounded">
                      {k}
                    </span>
                  ))}
                </div>
              </div>
              <span className="text-slate-500 text-xs">
                {expandedCard === card.number ? '▲' : '▼'}
              </span>
            </button>

            {expandedCard === card.number && (
              <div className="px-3 pb-3 space-y-3 border-t border-slate-700/50 pt-3">
                <div>
                  <p className="text-xs text-blue-400 mb-1">关键词</p>
                  <div className="flex flex-wrap gap-1">
                    {card.keywords.map(k => (
                      <span key={k} className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                  <p className="text-xs text-green-400 mb-1">正位含义</p>
                  <p className="text-sm text-slate-300 leading-relaxed">{card.upright}</p>
                </div>
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                  <p className="text-xs text-red-400 mb-1">逆位含义</p>
                  <p className="text-sm text-slate-300 leading-relaxed">{card.reversed}</p>
                </div>
              </div>
            )}
          </div>
        ))}
        {filteredCards.length === 0 && (
          <p className="text-center text-slate-500 text-sm py-8">没有找到匹配的牌</p>
        )}
      </div>
    </div>
  );
};

export default TarotGuide;
