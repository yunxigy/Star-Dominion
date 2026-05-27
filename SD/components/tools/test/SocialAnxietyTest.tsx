import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    q: '在众人面前发言时，我会感到紧张',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '参加聚会或社交活动让我感到不自在',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '和陌生人交谈时我会感到焦虑',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '我担心别人对我的看法和评价',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '在公共场合打电话让我不自在',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '被介绍给新朋友时我会感到不安',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '在餐厅或公共场合犯错让我很尴尬',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '我尽量避免成为众人关注的焦点',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '在社交场合中我会提前想好要说什么',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
    ],
  },
  {
    q: '社交活动结束后我会反复回想自己的表现',
    options: [
      { text: '完全不紧张', score: 0 },
      { text: '有点紧张', score: 1 },
      { text: '非常紧张', score: 2 },
      { text: '极度恐惧', score: 3 },
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

const getResult = (score: number, maxScore: number): ResultLevel => {
  const pct = (score / maxScore) * 100;
  if (pct <= 10) {
    return {
      name: '社牛',
      range: '0-3分',
      description: '你在社交场合中如鱼得水，完全没有社交焦虑的困扰。你享受与人交往的过程，能够自如地表达自己。',
      tips: ['继续保持你的社交热情', '你的自信可以感染和帮助身边的人'],
      color: 'text-green-400',
    };
  }
  if (pct <= 30) {
    return {
      name: '正常',
      range: '4-9分',
      description: '你的社交焦虑处于正常范围。偶尔会在某些场合感到紧张，但不影响正常生活。这是大多数人的状态。',
      tips: ['适度的紧张是正常的', '继续在社交中保持真实和自然'],
      color: 'text-green-400',
    };
  }
  if (pct <= 50) {
    return {
      name: '轻度社恐',
      range: '10-15分',
      description: '你在社交场合中会有明显的紧张感，有时会回避某些社交场景。虽然不至于严重影响生活，但确实给你带来了困扰。',
      tips: ['尝试渐进式地接触社交场景', '学习一些放松技巧（深呼吸、正念）', '关注社交中的积极体验而非可能的负面评价'],
      color: 'text-yellow-400',
    };
  }
  if (pct <= 75) {
    return {
      name: '中度社恐',
      range: '16-22分',
      description: '社交焦虑已经明显影响了你的日常生活。你可能经常回避社交场合，与人交往时感到很大的压力。',
      tips: ['建议学习认知行为疗法的技巧', '挑战消极的自我对话', '从小规模、安全的社交场景开始练习', '考虑寻求专业心理咨询的帮助'],
      color: 'text-orange-400',
    };
  }
  return {
    name: '重度社恐',
    range: '23-30分',
    description: '社交焦虑已经严重影响了你的生活质量。你可能极力回避社交场合，甚至影响到工作和学习。',
    tips: ['强烈建议寻求专业心理咨询', '认知行为疗法(CBT)对社交焦虑非常有效', '不要自我孤立，至少和信任的人保持联系', '改变需要时间和耐心，对自己保持善意'],
    color: 'text-red-400',
  };
};

const SocialAnxietyTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  const maxScore = QUESTIONS.length * 3;
  const result = done ? getResult(totalScore, maxScore) : null;
  const pct = (totalScore / maxScore) * 100;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">社恐指数测试</h3>
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
            <p className={`text-3xl font-bold ${result?.color}`}>{result?.name}</p>
            <p className="text-xs text-slate-400 mt-1">社恐指数：{Math.round(pct)}%</p>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${pct <= 30 ? 'bg-green-500' : pct <= 50 ? 'bg-yellow-500' : pct <= 75 ? 'bg-orange-500' : 'bg-red-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
            <p className="text-slate-300 text-xs leading-relaxed">{result?.description}</p>
            {result?.tips && result.tips.length > 0 && (
              <>
                <p className="text-violet-400 text-xs font-semibold mt-2">建议：</p>
                <ul className="space-y-1">
                  {result.tips.map((tip, i) => (
                    <li key={i} className="text-slate-300 text-xs flex items-start gap-1">
                      <span className="text-violet-400 mt-0.5">-</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button onClick={restart} className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded-lg transition-colors">
            重新测试
          </button>
        </div>
      )}
    </div>
  );
};

export default SocialAnxietyTest;
