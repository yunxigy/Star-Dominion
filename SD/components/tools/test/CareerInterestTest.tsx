import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '我喜欢动手操作机器或工具',
    options: [
      { text: '非常符合', scores: { R: 3 } },
      { text: '比较符合', scores: { R: 2 } },
      { text: '不太符合', scores: { R: 1 } },
      { text: '完全不符合', scores: { R: 0 } },
    ],
  },
  {
    q: '我喜欢户外活动和体力劳动',
    options: [
      { text: '非常符合', scores: { R: 3 } },
      { text: '比较符合', scores: { R: 2 } },
      { text: '不太符合', scores: { R: 1 } },
      { text: '完全不符合', scores: { R: 0 } },
    ],
  },
  {
    q: '我对科学研究和探索未知充满热情',
    options: [
      { text: '非常符合', scores: { I: 3 } },
      { text: '比较符合', scores: { I: 2 } },
      { text: '不太符合', scores: { I: 1 } },
      { text: '完全不符合', scores: { I: 0 } },
    ],
  },
  {
    q: '我喜欢分析数据和解决复杂问题',
    options: [
      { text: '非常符合', scores: { I: 3 } },
      { text: '比较符合', scores: { I: 2 } },
      { text: '不太符合', scores: { I: 1 } },
      { text: '完全不符合', scores: { I: 0 } },
    ],
  },
  {
    q: '我热爱艺术创作（绘画、写作、音乐等）',
    options: [
      { text: '非常符合', scores: { A: 3 } },
      { text: '比较符合', scores: { A: 2 } },
      { text: '不太符合', scores: { A: 1 } },
      { text: '完全不符合', scores: { A: 0 } },
    ],
  },
  {
    q: '我有丰富的想象力，喜欢创新设计',
    options: [
      { text: '非常符合', scores: { A: 3 } },
      { text: '比较符合', scores: { A: 2 } },
      { text: '不太符合', scores: { A: 1 } },
      { text: '完全不符合', scores: { A: 0 } },
    ],
  },
  {
    q: '我喜欢帮助他人解决问题或提供指导',
    options: [
      { text: '非常符合', scores: { S: 3 } },
      { text: '比较符合', scores: { S: 2 } },
      { text: '不太符合', scores: { S: 1 } },
      { text: '完全不符合', scores: { S: 0 } },
    ],
  },
  {
    q: '我在团队合作中感到愉快',
    options: [
      { text: '非常符合', scores: { S: 3 } },
      { text: '比较符合', scores: { S: 2 } },
      { text: '不太符合', scores: { S: 1 } },
      { text: '完全不符合', scores: { S: 0 } },
    ],
  },
  {
    q: '我喜欢领导团队和说服他人',
    options: [
      { text: '非常符合', scores: { E: 3 } },
      { text: '比较符合', scores: { E: 2 } },
      { text: '不太符合', scores: { E: 1 } },
      { text: '完全不符合', scores: { E: 0 } },
    ],
  },
  {
    q: '我对商业和创业感兴趣',
    options: [
      { text: '非常符合', scores: { E: 3 } },
      { text: '比较符合', scores: { E: 2 } },
      { text: '不太符合', scores: { E: 1 } },
      { text: '完全不符合', scores: { E: 0 } },
    ],
  },
  {
    q: '我喜欢有条理、有规则的工作环境',
    options: [
      { text: '非常符合', scores: { C: 3 } },
      { text: '比较符合', scores: { C: 2 } },
      { text: '不太符合', scores: { C: 1 } },
      { text: '完全不符合', scores: { C: 0 } },
    ],
  },
  {
    q: '我擅长处理数据、文件和细节工作',
    options: [
      { text: '非常符合', scores: { C: 3 } },
      { text: '比较符合', scores: { C: 2 } },
      { text: '不太符合', scores: { C: 1 } },
      { text: '完全不符合', scores: { C: 0 } },
    ],
  },
];

const TYPES: Record<string, { name: string; description: string; careers: string[] }> = {
  R: {
    name: '实际型 (Realistic)',
    description: '喜欢动手操作和实际解决问题。务实、注重行动，擅长使用工具和机器。',
    careers: ['工程师', '建筑师', '技师', '农业', '消防员', '运动员'],
  },
  I: {
    name: '研究型 (Investigative)',
    description: '热爱探索和分析，善于思考和研究。对科学和知识有强烈的追求。',
    careers: ['科学家', '医生', '程序员', '数据分析师', '研究员', '大学教授'],
  },
  A: {
    name: '艺术型 (Artistic)',
    description: '富有创造力和想象力，追求自我表达。对美和创新有独特的感知力。',
    careers: ['设计师', '作家', '音乐家', '导演', '画家', '摄影师'],
  },
  S: {
    name: '社会型 (Social)',
    description: '善于与人交往，乐于帮助他人。有强烈的责任感和同理心。',
    careers: ['教师', '心理咨询师', '社工', '护士', '人力资源', '培训师'],
  },
  E: {
    name: '企业型 (Enterprising)',
    description: '善于领导和说服他人，有很强的进取心和决策力。喜欢挑战和竞争。',
    careers: ['管理者', '销售', '律师', '创业者', '市场营销', '政治家'],
  },
  C: {
    name: '常规型 (Conventional)',
    description: '做事有条理、细心、可靠。擅长处理数据和遵守规则。',
    careers: ['会计', '银行职员', '行政助理', '审计师', '数据录入', '档案管理'],
  },
};

const CareerInterestTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
      .slice(0, 3)
      .map(([key]) => key);
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  const topTypes = done ? getTopTypes() : [];
  const allTypes = done ? Object.entries(scores).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">职业兴趣测试</h3>
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
          <p className="text-violet-400 font-semibold text-sm text-center">你的霍兰德职业兴趣</p>
          <div className="space-y-2">
            {allTypes.map(([key, val], idx) => {
              const t = TYPES[key];
              const isTop = topTypes.includes(key);
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-20 truncate">{t?.name.split('(')[0]}</span>
                  <div className="flex-1 bg-slate-700 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${isTop ? 'bg-violet-600' : 'bg-slate-600'}`}
                      style={{ width: `${(val / 6) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 w-6 text-right">{val}</span>
                </div>
              );
            })}
          </div>
          {topTypes.map((key, idx) => {
            const t = TYPES[key];
            return (
              <div key={key} className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="bg-violet-600 text-white text-xs px-2 py-0.5 rounded-full">
                    {idx === 0 ? '最匹配' : `第${idx + 1}匹配`}
                  </span>
                  <span className="text-violet-400 font-semibold text-sm">{t?.name}</span>
                </div>
                <p className="text-slate-300 text-xs leading-relaxed">{t?.description}</p>
                <p className="text-slate-400 text-xs">推荐职业：{t?.careers.join('、')}</p>
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

export default CareerInterestTest;
