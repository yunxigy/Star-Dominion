import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '我对自己和他人都有很高的标准，追求完美',
    options: [
      { text: '最符合', scores: { type1: 3 } },
      { text: '比较符合', scores: { type1: 2 } },
      { text: '不太符合', scores: { type1: 1 } },
      { text: '最不符合', scores: { type1: 0 } },
    ],
  },
  {
    q: '我乐于助人，常常把他人的需求放在自己前面',
    options: [
      { text: '最符合', scores: { type2: 3 } },
      { text: '比较符合', scores: { type2: 2 } },
      { text: '不太符合', scores: { type2: 1 } },
      { text: '最不符合', scores: { type2: 0 } },
    ],
  },
  {
    q: '我非常在意成就和成功，努力展现最好的自己',
    options: [
      { text: '最符合', scores: { type3: 3 } },
      { text: '比较符合', scores: { type3: 2 } },
      { text: '不太符合', scores: { type3: 1 } },
      { text: '最不符合', scores: { type3: 0 } },
    ],
  },
  {
    q: '我觉得自己与众不同，有强烈的情感体验',
    options: [
      { text: '最符合', scores: { type4: 3 } },
      { text: '比较符合', scores: { type4: 2 } },
      { text: '不太符合', scores: { type4: 1 } },
      { text: '最不符合', scores: { type4: 0 } },
    ],
  },
  {
    q: '我喜欢观察和思考，需要大量独处时间',
    options: [
      { text: '最符合', scores: { type5: 3 } },
      { text: '比较符合', scores: { type5: 2 } },
      { text: '不太符合', scores: { type5: 1 } },
      { text: '最不符合', scores: { type5: 0 } },
    ],
  },
  {
    q: '我经常担心事情会出错，对风险保持警惕',
    options: [
      { text: '最符合', scores: { type6: 3 } },
      { text: '比较符合', scores: { type6: 2 } },
      { text: '不太符合', scores: { type6: 1 } },
      { text: '最不符合', scores: { type6: 0 } },
    ],
  },
  {
    q: '我喜欢新鲜刺激的体验，害怕错过精彩的事物',
    options: [
      { text: '最符合', scores: { type7: 3 } },
      { text: '比较符合', scores: { type7: 2 } },
      { text: '不太符合', scores: { type7: 1 } },
      { text: '最不符合', scores: { type7: 0 } },
    ],
  },
  {
    q: '我性格强势，喜欢掌控局面',
    options: [
      { text: '最符合', scores: { type8: 3 } },
      { text: '比较符合', scores: { type8: 2 } },
      { text: '不太符合', scores: { type8: 1 } },
      { text: '最不符合', scores: { type8: 0 } },
    ],
  },
  {
    q: '我追求内心的平静，尽量避免冲突',
    options: [
      { text: '最符合', scores: { type9: 3 } },
      { text: '比较符合', scores: { type9: 2 } },
      { text: '不太符合', scores: { type9: 1 } },
      { text: '最不符合', scores: { type9: 0 } },
    ],
  },
];

const TYPES: Record<string, { name: string; description: string }> = {
  type1: { name: '完美主义者', description: '有原则、自律、追求完美。对自己和他人有很高的标准，内心有一个强烈的批评者。善于改进和优化，但需要学会接受不完美。' },
  type2: { name: '助人者', description: '温暖、关怀、慷慨。善于察觉他人的需求，乐于付出。但有时会忽视自己的需求，需要学会设定边界。' },
  type3: { name: '成就者', description: '适应力强、有抱负、注重形象。追求成功和认可，善于激励自己和他人。需要学会区分真正的自我和外在的成就。' },
  type4: { name: '个人主义者', description: '有创造力、敏感、富有表现力。追求独特性和真实性，有丰富的内心世界。需要学会管理情绪波动。' },
  type5: { name: '观察者', description: '有洞察力、独立、善于思考。喜欢探索知识，需要个人空间和时间。需要学会与他人分享自己的想法和感受。' },
  type6: { name: '忠诚者', description: '可靠、负责、善于预见问题。重视安全和忠诚，是很好的团队成员。需要学会信任自己的判断。' },
  type7: { name: '享乐主义者', description: '乐观、多才多艺、充满活力。喜欢新体验和可能性，善于带动气氛。需要学会面对不适和深入体验。' },
  type8: { name: '挑战者', description: '自信、果断、保护欲强。有强大的领导力，愿意为自己和他人挺身而出。需要学会展现脆弱的一面。' },
  type9: { name: '和平者', description: '随和、包容、善于调解。能够看到各方观点，追求和谐。需要学会表达自己的需求和主张。' },
};

const EnneagramTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  const getTopTypes = () => {
    return Object.entries(scores)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([key]) => key);
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">九型人格测试</h3>
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
          <p className="text-violet-400 font-semibold text-sm text-center">你的九型人格结果</p>
          {getTopTypes().map((typeKey, idx) => {
            const t = TYPES[typeKey];
            return (
              <div key={typeKey} className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="bg-violet-600 text-white text-xs px-2 py-0.5 rounded-full">
                    {idx === 0 ? '主要类型' : '次要类型'}
                  </span>
                  <span className="text-violet-400 font-semibold text-sm">{t?.name}</span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">{t?.description}</p>
              </div>
            );
          })}
          <button onClick={restart} className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded-lg transition-colors">
            重新测试
          </button>
        </div>
      )}
    </div>
  );
};

export default EnneagramTest;
