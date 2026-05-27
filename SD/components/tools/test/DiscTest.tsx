import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '面对挑战时，我倾向于：',
    options: [
      { text: '直接面对，快速行动', scores: { D: 3, I: 1, S: 0, C: 0 } },
      { text: '号召大家一起想办法', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '稳扎稳打，按计划执行', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '仔细分析风险后再行动', scores: { D: 1, I: 0, S: 0, C: 3 } },
    ],
  },
  {
    q: '在团队中，我通常扮演的角色是：',
    options: [
      { text: '决策者和领导者', scores: { D: 3, I: 0, S: 0, C: 1 } },
      { text: '气氛活跃者和协调者', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '稳定的支持者和执行者', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '质量把控者和细节专家', scores: { D: 0, I: 0, S: 1, C: 3 } },
    ],
  },
  {
    q: '别人认为我最突出的特点是：',
    options: [
      { text: '果断、有魄力', scores: { D: 3, I: 0, S: 0, C: 1 } },
      { text: '热情、有感染力', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '耐心、可靠', scores: { D: 0, I: 1, S: 3, C: 0 } },
      { text: '严谨、精确', scores: { D: 1, I: 0, S: 0, C: 3 } },
    ],
  },
  {
    q: '面对冲突时，我的反应是：',
    options: [
      { text: '直面冲突，据理力争', scores: { D: 3, I: 1, S: 0, C: 0 } },
      { text: '用幽默化解，寻找共识', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '退让一步，维护和谐', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '收集证据，用事实说话', scores: { D: 1, I: 0, S: 0, C: 3 } },
    ],
  },
  {
    q: '我最理想的工作环境是：',
    options: [
      { text: '有挑战、有权力、能快速决策', scores: { D: 3, I: 0, S: 0, C: 1 } },
      { text: '开放自由、人际关系融洽', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '稳定有序、同事友善', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '规范明确、注重质量', scores: { D: 0, I: 0, S: 1, C: 3 } },
    ],
  },
  {
    q: '做报告时，我更注重：',
    options: [
      { text: '结果和效率', scores: { D: 3, I: 1, S: 0, C: 0 } },
      { text: '互动和感染力', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '条理清晰、循序渐进', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '数据准确、逻辑严密', scores: { D: 1, I: 0, S: 0, C: 3 } },
    ],
  },
  {
    q: '别人向我求助时，我通常：',
    options: [
      { text: '快速给出解决方案', scores: { D: 3, I: 0, S: 1, C: 0 } },
      { text: '鼓励和安慰对方', scores: { D: 0, I: 3, S: 1, C: 0 } },
      { text: '耐心倾听并陪伴', scores: { D: 0, I: 1, S: 3, C: 0 } },
      { text: '详细了解情况后分析', scores: { D: 0, I: 0, S: 1, C: 3 } },
    ],
  },
  {
    q: '面对截止日期，我：',
    options: [
      { text: '提前推进，确保按时完成', scores: { D: 3, I: 0, S: 1, C: 1 } },
      { text: '最后冲刺也能完成', scores: { D: 1, I: 3, S: 0, C: 0 } },
      { text: '按部就班，稳定输出', scores: { D: 0, I: 0, S: 3, C: 1 } },
      { text: '严格按计划，保证质量', scores: { D: 0, I: 0, S: 1, C: 3 } },
    ],
  },
];

const TYPES: Record<string, { name: string; description: string; workplace: string }> = {
  D: {
    name: '支配型 (Dominance)',
    description: '你是一个天生的领导者，果断、自信、目标导向。你喜欢挑战，善于做决策，追求结果。你直接、高效，有时可能显得强势。',
    workplace: '适合担任管理岗位和决策角色。建议：注意倾听他人意见，给团队成员更多表达空间。学会授权，不要事事亲力亲为。发挥你推动项目的领导力优势。',
  },
  I: {
    name: '影响型 (Influence)',
    description: '你热情开朗，善于社交和激励他人。你乐观、有创意，是团队中的气氛活跃者。你善于表达和说服，但有时可能忽视细节。',
    workplace: '适合销售、公关、培训等需要人际交往的岗位。建议：注意跟进细节和承诺，培养时间管理能力。发挥你鼓舞团队士气的优势。',
  },
  S: {
    name: '稳健型 (Steadiness)',
    description: '你耐心、可靠、善于倾听。你重视和谐与稳定，是团队中不可或缺的支持者。你做事踏实，但有时可能不太善于应对变化。',
    workplace: '适合客户服务、行政支持等需要耐心的岗位。建议：学习在适当时候表达自己的需求和想法，不要总是默默承受。发挥你维系团队稳定的优势。',
  },
  C: {
    name: '谨慎型 (Conscientiousness)',
    description: '你严谨、精确、追求完美。你善于分析和规划，注重质量和标准。你做事有条理，但有时可能过于追求完美而影响效率。',
    workplace: '适合财务、质检、研发等需要精确性的岗位。建议：学会在"足够好"和"完美"之间找到平衡，不要过度纠结细节。发挥你把控质量的优势。',
  },
};

const DiscTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [current, setCurrent] = useState(0);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [done, setDone] = useState(false);

  const handleAnswer = (optionIndex: number) => {
    const option = QUESTIONS[current].options[optionIndex];
    const newScores = { ...scores };
    Object.entries(option.scores).forEach(([key, val]) => {
      newScores[key] = (newScores[key] || 0) + val;
    });
    setScores(newScores);
    if (current < QUESTIONS.length - 1) {
      setCurrent(current + 1);
    } else {
      setDone(true);
    }
  };

  const getDominant = () => {
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'D';
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  const dominant = done ? getDominant() : '';
  const resultData = TYPES[dominant];
  const allTypes = done ? Object.entries(scores).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">DISC 职场性格测试</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-xs">关闭</button>
      </div>

      {!done ? (
        <>
          <div className="w-full bg-slate-700 rounded-full h-1.5">
            <div
              className="bg-violet-600 h-1.5 rounded-full transition-all"
              style={{ width: `${((current + 1) / QUESTIONS.length) * 100}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">第 {current + 1}/{QUESTIONS.length} 题</p>
          <p className="text-slate-200 text-sm">{QUESTIONS[current].q}</p>
          <div className="space-y-2">
            {QUESTIONS[current].options.map((opt, i) => (
              <button
                key={i}
                onClick={() => handleAnswer(i)}
                className="w-full text-left bg-slate-700/50 border border-slate-600 rounded-lg p-2.5 text-sm text-slate-200 hover:bg-violet-600/30 hover:border-violet-500 transition-all"
              >
                {opt.text}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="space-y-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-violet-400 mb-1">{dominant}</p>
            <p className="text-slate-200 font-medium text-sm">{resultData?.name}</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {allTypes.map(([key, val]) => (
              <div key={key} className="text-center">
                <div className="bg-slate-700 rounded-lg p-2 relative overflow-hidden">
                  <div
                    className={`absolute bottom-0 left-0 right-0 transition-all ${key === dominant ? 'bg-violet-600/40' : 'bg-slate-600/30'}`}
                    style={{ height: `${(val / 24) * 100}%` }}
                  />
                  <p className="text-xs text-slate-400 relative z-10">{key}</p>
                  <p className="text-lg font-bold text-violet-400 relative z-10">{val}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
            <p className="text-violet-400 font-semibold text-xs">人格特征</p>
            <p className="text-slate-300 text-xs leading-relaxed">{resultData?.description}</p>
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
            <p className="text-violet-400 font-semibold text-xs">职场建议</p>
            <p className="text-slate-300 text-xs leading-relaxed">{resultData?.workplace}</p>
          </div>
          <button onClick={restart} className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded-lg transition-colors">
            重新测试
          </button>
        </div>
      )}
    </div>
  );
};

export default DiscTest;
