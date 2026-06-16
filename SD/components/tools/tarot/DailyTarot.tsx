import React, { useState, useCallback } from 'react';
import { TarotCardVisual } from './TarotCardVisual';

interface TarotCard {
  number: number;
  name: string;
  emoji: string;
  keywords: string[];
  upright: string;
  reversed: string;
  uprightMessage: string;
  reversedMessage: string;
}

const MAJOR_ARCANA: TarotCard[] = [
  { number: 0, name: '愚者', emoji: '🃏', keywords: ['新开始', '冒险', '自由'], upright: '新开始/冒险/自由', reversed: '鲁莽/不计后果/停滞', uprightMessage: '今天是开启新旅程的绝佳时机。保持开放的心态，勇敢地迈出第一步。宇宙正在为你铺设道路，信任直觉，拥抱未知。', reversedMessage: '今天需要谨慎行事，避免冲动决定。花时间思考再行动，不要被表面的自由所迷惑。' },
  { number: 1, name: '魔术师', emoji: '🎩', keywords: ['创造力', '意志力', '技能'], upright: '创造力/意志力/技能', reversed: '操控/欺骗/能力不足', uprightMessage: '你拥有实现目标所需的一切资源和能力。今天是展现才华、施展技能的好日子。集中精力，化想法为现实。', reversedMessage: '今天可能会感到力不从心，重新审视自己的目标和方法。避免投机取巧，脚踏实地才是正道。' },
  { number: 2, name: '女祭司', emoji: '🌙', keywords: ['直觉', '潜意识', '神秘'], upright: '直觉/潜意识/神秘', reversed: '忽视直觉/表面化/秘密', uprightMessage: '倾听内心的声音，你的直觉今天格外准确。静下心来冥想，隐藏的真相会向你显现。', reversedMessage: '你可能忽略了内心的警告信号。不要只看表面，深入探索事物的本质。' },
  { number: 3, name: '皇后', emoji: '👑', keywords: ['丰收', '母性', '自然'], upright: '丰收/母性/自然', reversed: '依赖/过度保护/创造力受阻', uprightMessage: '今天充满丰盛与美好。享受生活的乐趣，关爱自己和身边的人。创意和感性将带来丰硕成果。', reversedMessage: '注意不要过度照顾他人而忽略自己。找回自我关爱的平衡点。' },
  { number: 4, name: '皇帝', emoji: '🏛️', keywords: ['权威', '结构', '领导力'], upright: '权威/结构/领导力', reversed: '专制/僵化/控制欲', uprightMessage: '今天适合展现领导力和决断力。建立秩序，制定规则，你的权威将得到认可。', reversedMessage: '避免过于强硬或控制他人。灵活性比固执己见更能解决问题。' },
  { number: 5, name: '教皇', emoji: '📿', keywords: ['传统', '信仰', '教育'], upright: '传统/信仰/教育', reversed: '叛逆/非传统/教条主义', uprightMessage: '遵循传统智慧和既定规则会带来指引。今天适合学习、请教前辈或寻求精神上的启迪。', reversedMessage: '质疑旧有观念，寻找适合自己的道路。不必盲从权威。' },
  { number: 6, name: '恋人', emoji: '💕', keywords: ['爱情', '选择', '和谐'], upright: '爱情/选择/和谐', reversed: '不和谐/价值观冲突/错误选择', uprightMessage: '爱与和谐弥漫在今天的关系中。做出忠于内心的选择，真诚的连接将更加深厚。', reversedMessage: '审视关系中的不平衡，坦诚沟通才能化解分歧。' },
  { number: 7, name: '战车', emoji: '🏇', keywords: ['胜利', '意志', '决心'], upright: '胜利/意志/决心', reversed: '失控/挫败/缺乏方向', uprightMessage: '坚定的意志力将带你走向胜利。今天是克服障碍、取得进展的好日子。勇往直前！', reversedMessage: '感觉失去方向或控制。停下来重新调整目标，不要盲目冲锋。' },
  { number: 8, name: '力量', emoji: '🦁', keywords: ['勇气', '耐心', '内在力量'], upright: '勇气/耐心/内在力量', reversed: '自我怀疑/脆弱/缺乏勇气', uprightMessage: '你内心拥有无比强大的力量。用温柔而坚定的方式面对挑战，耐心和勇气将战胜一切。', reversedMessage: '今天可能感到不安或自我怀疑。记住，脆弱也是力量的一部分。给自己一些温柔。' },
  { number: 9, name: '隐者', emoji: '🏔️', keywords: ['内省', '孤独', '智慧'], upright: '内省/孤独/智慧', reversed: '孤立/逃避/固执', uprightMessage: '今天适合独处和深度思考。远离喧嚣，向内探索，你将获得宝贵的智慧和洞见。', reversedMessage: '不要过度孤立自己。适度社交和外界输入同样重要。' },
  { number: 10, name: '命运之轮', emoji: '🎡', keywords: ['命运', '转变', '机遇'], upright: '命运/转变/机遇', reversed: '抗拒改变/坏运气/失控', uprightMessage: '命运之轮正在转动，变化和机遇即将来临。保持灵活，顺应潮流，好运正在路上。', reversedMessage: '目前可能处于低潮期，但这也只是暂时的。耐心等待，时机终将到来。' },
  { number: 11, name: '正义', emoji: '⚖️', keywords: ['公平', '真相', '因果'], upright: '公平/真相/因果', reversed: '不公正/逃避责任/偏见', uprightMessage: '真相和公正今天会显现。诚实地面对自己和他人，善因结善果，公平终将到来。', reversedMessage: '审视自己是否承担了应有的责任。避免偏见和不公正的行为。' },
  { number: 12, name: '倒吊人', emoji: '🔄', keywords: ['牺牲', '放手', '新视角'], upright: '牺牲/放手/新视角', reversed: '拖延/无谓牺牲/固执', uprightMessage: '换个角度看问题，你会有全新的领悟。适当的放手和牺牲会带来意想不到的收获。', reversedMessage: '检查是否有不必要的牺牲。不要拖延改变，有时候坚持并不总是美德。' },
  { number: 13, name: '死神', emoji: '🦋', keywords: ['结束', '转变', '重生'], upright: '结束/转变/重生', reversed: '抗拒结束/恐惧改变/停滞', uprightMessage: '一个阶段的结束意味着新阶段的开始。拥抱转变，放下旧的，你将迎来焕然一新的重生。', reversedMessage: '你可能在抗拒必要的改变。接受结束是新开始的前提，勇敢放手。' },
  { number: 14, name: '节制', emoji: '⏳', keywords: ['平衡', '耐心', '调和'], upright: '平衡/耐心/调和', reversed: '失衡/过度/缺乏耐心', uprightMessage: '今天需要在各方面找到平衡。耐心调和不同的元素，中庸之道将带来和谐与满足。', reversedMessage: '生活中某些方面可能失衡了。重新审视优先级，找到健康的中间点。' },
  { number: 15, name: '恶魔', emoji: '😈', keywords: ['束缚', '欲望', '物质'], upright: '束缚/欲望/物质', reversed: '解脱/打破束缚/觉醒', uprightMessage: '警惕物质欲望和不良习惯的束缚。认清哪些是真正的需求，哪些是虚假的诱惑。', reversedMessage: '你正在或即将摆脱某种束缚。这是觉醒和解放的时刻，拥抱自由。' },
  { number: 16, name: '塔', emoji: '⚡', keywords: ['突变', '混乱', '觉醒'], upright: '突变/混乱/觉醒', reversed: '逃避灾难/恐惧改变/延迟', uprightMessage: '突如其来的变化可能会打乱计划，但这也是破旧立新的契机。在废墟上重建更坚固的基础。', reversedMessage: '可能避免了一场灾难，或在延迟不可避免的改变。正视必要的变革。' },
  { number: 17, name: '星星', emoji: '⭐', keywords: ['希望', '灵感', '宁静'], upright: '希望/灵感/宁静', reversed: '绝望/失去信心/创意枯竭', uprightMessage: '希望的星光照亮前路。保持信念，灵感和宁静正在治愈你。最美好的事物正在到来。', reversedMessage: '暂时看不到希望，但星光从未消失。重新连接内心的信念和梦想。' },
  { number: 18, name: '月亮', emoji: '🌕', keywords: ['幻象', '恐惧', '潜意识'], upright: '幻象/恐惧/潜意识', reversed: '克服恐惧/真相显现/困惑消散', uprightMessage: '今天的某些事情可能并非如表面所见。信任直觉，穿越迷雾，不要被恐惧所迷惑。', reversedMessage: '困惑正在消散，真相逐渐明朗。你正在克服内心的恐惧。' },
  { number: 19, name: '太阳', emoji: '☀️', keywords: ['快乐', '成功', '活力'], upright: '快乐/成功/活力', reversed: '暂时受挫/过度乐观/延迟的成功', uprightMessage: '阳光灿烂的一天！快乐、成功和活力充满你的生活。享受这份美好，分享你的光芒。', reversedMessage: '快乐和成功可能暂时被遮蔽，但阳光终会普照。保持乐观，好事正在路上。' },
  { number: 20, name: '审判', emoji: '📯', keywords: ['觉醒', '重生', '召唤'], upright: '觉醒/重生/召唤', reversed: '自我怀疑/拒绝觉醒/逃避审视', uprightMessage: '内心的召唤正在唤醒你。审视过去，接受评判，你将迎来更高层次的觉醒和重生。', reversedMessage: '你可能在逃避自我审视。勇敢面对内心的声音，觉醒的时刻已经到来。' },
  { number: 21, name: '世界', emoji: '🌍', keywords: ['完成', '整合', '成就'], upright: '完成/整合/成就', reversed: '未完成/缺乏闭合/短视', uprightMessage: '一个重要的循环即将圆满完成。庆祝你的成就，整合所学，为新的旅程做好准备。', reversedMessage: '感觉差一步就能完成。审视还有什么需要收尾，不要半途而废。' },
];

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
    const cardIndex = Math.floor(seededRandom(seed) * 22);
    const isReversed = seededRandom(seed + 1) > 0.5;
    setCard({ data: MAJOR_ARCANA[cardIndex], reversed: isReversed });
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
