import React, { useState, useMemo } from 'react';

const LIFE_PATH_MEANINGS: Record<number, { title: string; emoji: string; traits: string[]; description: string; career: string; love: string }> = {
  1: {
    title: '领导者',
    emoji: '👑',
    traits: ['独立', '自信', '创新', '领导力', '决心'],
    description: '生命灵数1的人天生具有领导才能，独立自主，勇于开拓。你有强烈的自我意识和创造力，喜欢做第一个吃螃蟹的人。你的存在本身就是一种力量的象征。',
    career: '适合创业、管理、独立工作。你在需要决断力和创新精神的领域会表现出色。',
    love: '在感情中需要保持独立性，同时学会与伴侣平等相处。你需要一个尊重你独立性的伴侣。',
  },
  2: {
    title: '协调者',
    emoji: '🤝',
    traits: ['合作', '敏感', '外交', '耐心', '和谐'],
    description: '生命灵数2的人是天生的协调者和调解者。你善于倾听，富有同理心，能够在冲突中找到平衡。你的温柔和耐心是你最大的力量。',
    career: '适合人力资源、咨询、外交、教育等需要人际交往的工作。你是团队中不可或缺的润滑剂。',
    love: '在感情中温柔体贴，善于营造和谐的氛围。你需要一个能给你安全感的伴侣。',
  },
  3: {
    title: '创造者',
    emoji: '🎨',
    traits: ['创意', '表达', '乐观', '社交', '艺术'],
    description: '生命灵数3的人充满创意和表现力。你天生具有艺术气质，善于用语言、文字或艺术表达自己。你的乐观和幽默感总能感染身边的人。',
    career: '适合艺术、写作、演艺、设计、营销等创意领域。你的表达能力是你的核心竞争力。',
    love: '在感情中浪漫而有趣，需要一个能欣赏你创意和幽默的伴侣。',
  },
  4: {
    title: '建造者',
    emoji: '🏗️',
    traits: ['稳定', '务实', '组织', '忠诚', '勤奋'],
    description: '生命灵数4的人是可靠的建造者和执行者。你脚踏实地，做事有条不紊，是值得信赖的人。你的坚持和耐心能将想法变为现实。',
    career: '适合工程、会计、管理、建筑等需要严谨和组织能力的工作。你是任何团队的坚实后盾。',
    love: '在感情中忠诚可靠，重视承诺。你需要一个同样重视稳定和家庭的伴侣。',
  },
  5: {
    title: '冒险家',
    emoji: '🌍',
    traits: ['自由', '变化', '冒险', '适应', '好奇'],
    description: '生命灵数5的人是天生的冒险家和自由灵魂。你热爱变化和新鲜事物，适应能力强，总是在探索未知的领域。',
    career: '适合旅游、媒体、销售、创业等充满变化和挑战的领域。你无法忍受单调乏味的工作。',
    love: '在感情中需要自由和空间，害怕被束缚。你需要一个能与你一起冒险的伴侣。',
  },
  6: {
    title: '守护者',
    emoji: '🏠',
    traits: ['责任', '关爱', '家庭', '奉献', '平衡'],
    description: '生命灵数6的人是天生的守护者和照顾者。你重视家庭和责任，富有爱心和奉献精神。你的温暖和关怀让身边的人感到安心。',
    career: '适合医疗、教育、社会工作、咨询等服务他人的领域。你在需要关怀和责任的工作中会发光发热。',
    love: '在感情中全心投入，重视家庭。你需要一个同样重视家庭和承诺的伴侣。',
  },
  7: {
    title: '思考者',
    emoji: '🔍',
    traits: ['分析', '直觉', '智慧', '内省', '神秘'],
    description: '生命灵数7的人是深邃的思考者和探索者。你拥有敏锐的直觉和分析能力，喜欢探索事物的本质和真理。',
    career: '适合研究、科学、哲学、心理学等需要深度思考的领域。你在独立研究中会取得突破。',
    love: '在感情中需要精神层面的连接。你需要一个能与你进行深度交流的伴侣。',
  },
  8: {
    title: '成就者',
    emoji: '💎',
    traits: ['权力', '成功', '物质', '组织', '判断'],
    description: '生命灵数8的人是天生的成就者和实干家。你有强烈的成功欲望和商业头脑，善于把握机会，创造财富。',
    career: '适合商业、金融、管理、法律等需要决策力和组织能力的领域。你在商界会大展宏图。',
    love: '在感情中可能过于注重物质和地位。学会平衡事业和感情生活是你的课题。',
  },
  9: {
    title: '智者',
    emoji: '🌟',
    traits: ['博爱', '理想', '智慧', '奉献', '人道'],
    description: '生命灵数9的人是充满智慧和博爱精神的人。你有强烈的人道主义精神，关心世界的命运，愿意为更大的善而奉献。',
    career: '适合公益、教育、艺术、医疗等服务社会的领域。你在帮助他人的工作中会找到人生意义。',
    love: '在感情中理想主义，需要一个与你有共同价值观的伴侣。学会接受不完美是你的课题。',
  },
  11: {
    title: '直觉大师',
    emoji: '🔮',
    traits: ['直觉', '灵感', '灵性', '理想', '敏感'],
    description: '生命灵数11是大师数字，代表极高的直觉力和灵性觉醒。你拥有非凡的洞察力，能感知他人无法察觉的细微能量。你的存在本身就是一种灵感的源泉。',
    career: '适合心理咨询、艺术创作、灵性导师、创意产业等领域。你的直觉和创造力是无价的资产。',
    love: '在感情中极度敏感和深刻，需要一个理解你灵性世界的伴侣。你的爱是深刻而 transformative 的。',
  },
  22: {
    title: '大师建造者',
    emoji: '🏛️',
    traits: ['远见', '实践', '领导', '成就', '力量'],
    description: '生命灵数22是最强大的大师数字，被称为"大师建造者"。你拥有将宏大愿景变为现实的非凡能力，既有远大的理想，又有落地执行的毅力。',
    career: '适合大型项目管理、企业领导、建筑、政治等需要宏大视野和执行力的领域。你能成就非凡事业。',
    love: '在感情中需要一个能与你并肩建设未来的伴侣。你的伴侣需要理解你对事业的执着和对伟大目标的追求。',
  },
};

const LifePathNumber: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const [day, setDay] = useState('');
  const [result, setResult] = useState<number | null>(null);

  const calculate = () => {
    const y = parseInt(year);
    const m = parseInt(month);
    const d = parseInt(day);
    if (!y || !m || !d || y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return;

    const sumDigits = (n: number): number => {
      let sum = 0;
      while (n > 0) {
        sum += n % 10;
        n = Math.floor(n / 10);
      }
      return sum;
    };

    let total = sumDigits(y) + sumDigits(m) + sumDigits(d);
    // Preserve master numbers 11, 22, 33
    while (total > 9 && total !== 11 && total !== 22 && total !== 33) {
      total = sumDigits(total);
    }
    // If 33, treat as 6 (33 is rare and maps to 6's energy)
    if (total === 33) total = 6;
    setResult(total);
  };

  const meaning = result !== null ? LIFE_PATH_MEANINGS[result] : null;

  return (
    <div className="space-y-4">
      <div className="text-center mb-2">
        <p className="text-slate-400 text-sm">输入你的出生日期，计算生命灵数</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">年</label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(e.target.value)}
            placeholder="1990"
            min="1900"
            max="2100"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">月</label>
          <input
            type="number"
            value={month}
            onChange={e => setMonth(e.target.value)}
            placeholder="1"
            min="1"
            max="12"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
          />
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">日</label>
          <input
            type="number"
            value={day}
            onChange={e => setDay(e.target.value)}
            placeholder="15"
            min="1"
            max="31"
            className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500/50 placeholder-slate-500"
          />
        </div>
      </div>

      <button
        onClick={calculate}
        disabled={!year || !month || !day}
        className="w-full px-6 py-3 bg-blue-500/20 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/30 transition-all text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
      >
        ✨ 计算生命灵数
      </button>

      {result !== null && meaning && (
        <div className="space-y-3">
          <div className="bg-slate-800/50 border border-blue-500/30 rounded-lg p-4 text-center">
            <div className="text-6xl mb-2">{meaning.emoji}</div>
            <div className="text-4xl font-bold text-blue-400 mb-1">{result}</div>
            <div className="text-lg text-slate-200 font-medium">{meaning.title}</div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <p className="text-xs text-blue-400 mb-2">特质标签</p>
            <div className="flex flex-wrap gap-1">
              {meaning.traits.map(t => (
                <span key={t} className="text-xs px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <p className="text-xs text-blue-400 mb-1">性格解读</p>
            <p className="text-sm text-slate-300 leading-relaxed">{meaning.description}</p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <p className="text-xs text-blue-400 mb-1">事业方向</p>
            <p className="text-sm text-slate-300 leading-relaxed">{meaning.career}</p>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <p className="text-xs text-blue-400 mb-1">感情建议</p>
            <p className="text-sm text-slate-300 leading-relaxed">{meaning.love}</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default LifePathNumber;
