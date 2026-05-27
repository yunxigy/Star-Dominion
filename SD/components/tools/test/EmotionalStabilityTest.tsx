import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    q: '遇到突发状况时，我能保持冷静',
    options: [
      { text: '总是', score: 4 },
      { text: '经常', score: 3 },
      { text: '偶尔', score: 2 },
      { text: '从不', score: 1 },
    ],
  },
  {
    q: '别人的一句话可能会让我情绪低落很久',
    options: [
      { text: '从不', score: 4 },
      { text: '偶尔', score: 3 },
      { text: '经常', score: 2 },
      { text: '总是', score: 1 },
    ],
  },
  {
    q: '面对批评时，我能理性地看待和处理',
    options: [
      { text: '总是', score: 4 },
      { text: '经常', score: 3 },
      { text: '偶尔', score: 2 },
      { text: '从不', score: 1 },
    ],
  },
  {
    q: '我经常因为小事而感到烦躁或生气',
    options: [
      { text: '从不', score: 4 },
      { text: '偶尔', score: 3 },
      { text: '经常', score: 2 },
      { text: '总是', score: 1 },
    ],
  },
  {
    q: '面对挫折时，我能很快恢复积极的心态',
    options: [
      { text: '总是', score: 4 },
      { text: '经常', score: 3 },
      { text: '偶尔', score: 2 },
      { text: '从不', score: 1 },
    ],
  },
  {
    q: '我容易受到周围人情绪的影响',
    options: [
      { text: '从不', score: 4 },
      { text: '偶尔', score: 3 },
      { text: '经常', score: 2 },
      { text: '总是', score: 1 },
    ],
  },
  {
    q: '压力大的时候我仍能正常工作和生活',
    options: [
      { text: '总是', score: 4 },
      { text: '经常', score: 3 },
      { text: '偶尔', score: 2 },
      { text: '从不', score: 1 },
    ],
  },
  {
    q: '我会反复纠结过去发生的事情',
    options: [
      { text: '从不', score: 4 },
      { text: '偶尔', score: 3 },
      { text: '经常', score: 2 },
      { text: '总是', score: 1 },
    ],
  },
  {
    q: '面对不确定性时，我能坦然接受',
    options: [
      { text: '总是', score: 4 },
      { text: '经常', score: 3 },
      { text: '偶尔', score: 2 },
      { text: '从不', score: 1 },
    ],
  },
  {
    q: '我经常感到莫名的焦虑或不安',
    options: [
      { text: '从不', score: 4 },
      { text: '偶尔', score: 3 },
      { text: '经常', score: 2 },
      { text: '总是', score: 1 },
    ],
  },
];

interface ResultLevel {
  name: string;
  range: string;
  description: string;
  tips: string[];
  color: string;
}

const getResult = (score: number): ResultLevel => {
  if (score >= 36) {
    return {
      name: '非常稳定',
      range: '36-40分',
      description: '你的情绪非常稳定，能够在各种情况下保持冷静和理性。你有很强的情绪调节能力，不容易被外界因素影响。',
      tips: [
        '继续保持你的情绪管理能力',
        '在稳定的同时也要允许自己表达情感',
        '可以将你的经验分享给身边需要帮助的人',
      ],
      color: 'text-green-400',
    };
  }
  if (score >= 29) {
    return {
      name: '稳定',
      range: '29-35分',
      description: '你的情绪比较稳定，大多数情况下能够应对压力和挑战。偶尔会有情绪波动，但能较快恢复。',
      tips: [
        '继续保持良好的情绪管理习惯',
        '在压力较大时适当进行放松活动',
        '培养一些有助于情绪调节的爱好',
      ],
      color: 'text-green-400',
    };
  }
  if (score >= 21) {
    return {
      name: '一般',
      range: '21-28分',
      description: '你的情绪稳定性处于中等水平。有时能保持冷静，有时会被情绪所影响。有提升的空间。',
      tips: [
        '学习识别和命名自己的情绪',
        '练习深呼吸和冥想来调节情绪',
        '建立规律的作息和运动习惯',
        '学会区分"能控制的"和"不能控制的"',
      ],
      color: 'text-yellow-400',
    };
  }
  if (score >= 14) {
    return {
      name: '不稳定',
      range: '14-20分',
      description: '你的情绪波动较大，容易受到外界影响。压力和挫折可能让你感到不知所措。',
      tips: [
        '建议学习系统的情绪管理技巧',
        '练习正念冥想，培养觉察情绪的能力',
        '建立支持系统，和信任的人分享感受',
        '减少咖啡因和酒精的摄入',
        '考虑寻求心理咨询的帮助',
      ],
      color: 'text-orange-400',
    };
  }
  return {
    name: '非常不稳定',
    range: '10-13分',
    description: '你的情绪波动非常大，经常被情绪所控制。这可能严重影响了你的日常生活和人际关系。',
    tips: [
      '强烈建议寻求专业心理咨询师的帮助',
      '学习情绪调节技巧（如辩证行为疗法DBT）',
      '建立稳定的日常作息',
      '避免在情绪激动时做重要决定',
      '记住：寻求帮助是勇敢的表现',
    ],
    color: 'text-red-400',
  };
};

const EmotionalStabilityTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [current, setCurrent] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [done, setDone] = useState(false);

  const handleAnswer = (optionIndex: number) => {
    const option = QUESTIONS[current].options[optionIndex];
    setTotalScore(totalScore + option.score);
    if (current < QUESTIONS.length - 1) {
      setCurrent(current + 1);
    } else {
      setDone(true);
    }
  };

  const restart = () => {
    setCurrent(0);
    setTotalScore(0);
    setDone(false);
  };

  const result = done ? getResult(totalScore) : null;
  const maxScore = QUESTIONS.length * 4;
  const pct = (totalScore / maxScore) * 100;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">情绪稳定性测试</h3>
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
            <p className="text-3xl font-bold text-violet-400">{totalScore}</p>
            <p className="text-xs text-slate-400">总分 {maxScore} 分</p>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${pct >= 72 ? 'bg-green-500' : pct >= 58 ? 'bg-green-400' : pct >= 42 ? 'bg-yellow-500' : pct >= 28 ? 'bg-orange-500' : 'bg-red-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-center">
            <p className={`text-xl font-bold ${result?.color}`}>{result?.name}</p>
            <p className="text-xs text-slate-400">{result?.range}</p>
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
            <p className="text-slate-300 text-xs leading-relaxed">{result?.description}</p>
            <p className="text-violet-400 text-xs font-semibold mt-2">建议：</p>
            <ul className="space-y-1">
              {result?.tips.map((tip, i) => (
                <li key={i} className="text-slate-300 text-xs flex items-start gap-1">
                  <span className="text-violet-400 mt-0.5">-</span>
                  {tip}
                </li>
              ))}
            </ul>
          </div>
          <button onClick={restart} className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded-lg transition-colors">
            重新测试
          </button>
        </div>
      )}
    </div>
  );
};

export default EmotionalStabilityTest;
