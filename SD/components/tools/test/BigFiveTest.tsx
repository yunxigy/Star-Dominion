import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '我喜欢尝试新事物和新体验',
    options: [
      { text: '非常不同意', scores: { openness: 1 } },
      { text: '不同意', scores: { openness: 2 } },
      { text: '中立', scores: { openness: 3 } },
      { text: '同意', scores: { openness: 4 } },
      { text: '非常同意', scores: { openness: 5 } },
    ],
  },
  {
    q: '我对艺术和美学有很强的感受力',
    options: [
      { text: '非常不同意', scores: { openness: 1 } },
      { text: '不同意', scores: { openness: 2 } },
      { text: '中立', scores: { openness: 3 } },
      { text: '同意', scores: { openness: 4 } },
      { text: '非常同意', scores: { openness: 5 } },
    ],
  },
  {
    q: '我做事有条理，善于制定计划',
    options: [
      { text: '非常不同意', scores: { conscientiousness: 1 } },
      { text: '不同意', scores: { conscientiousness: 2 } },
      { text: '中立', scores: { conscientiousness: 3 } },
      { text: '同意', scores: { conscientiousness: 4 } },
      { text: '非常同意', scores: { conscientiousness: 5 } },
    ],
  },
  {
    q: '我会坚持完成任务直到结束',
    options: [
      { text: '非常不同意', scores: { conscientiousness: 1 } },
      { text: '不同意', scores: { conscientiousness: 2 } },
      { text: '中立', scores: { conscientiousness: 3 } },
      { text: '同意', scores: { conscientiousness: 4 } },
      { text: '非常同意', scores: { conscientiousness: 5 } },
    ],
  },
  {
    q: '我喜欢参加社交活动和聚会',
    options: [
      { text: '非常不同意', scores: { extraversion: 1 } },
      { text: '不同意', scores: { extraversion: 2 } },
      { text: '中立', scores: { extraversion: 3 } },
      { text: '同意', scores: { extraversion: 4 } },
      { text: '非常同意', scores: { extraversion: 5 } },
    ],
  },
  {
    q: '我在人群中感到充满活力',
    options: [
      { text: '非常不同意', scores: { extraversion: 1 } },
      { text: '不同意', scores: { extraversion: 2 } },
      { text: '中立', scores: { extraversion: 3 } },
      { text: '同意', scores: { extraversion: 4 } },
      { text: '非常同意', scores: { extraversion: 5 } },
    ],
  },
  {
    q: '我通常信任他人',
    options: [
      { text: '非常不同意', scores: { agreeableness: 1 } },
      { text: '不同意', scores: { agreeableness: 2 } },
      { text: '中立', scores: { agreeableness: 3 } },
      { text: '同意', scores: { agreeableness: 4 } },
      { text: '非常同意', scores: { agreeableness: 5 } },
    ],
  },
  {
    q: '我愿意帮助有需要的人',
    options: [
      { text: '非常不同意', scores: { agreeableness: 1 } },
      { text: '不同意', scores: { agreeableness: 2 } },
      { text: '中立', scores: { agreeableness: 3 } },
      { text: '同意', scores: { agreeableness: 4 } },
      { text: '非常同意', scores: { agreeableness: 5 } },
    ],
  },
  {
    q: '我经常感到焦虑或紧张',
    options: [
      { text: '非常不同意', scores: { neuroticism: 1 } },
      { text: '不同意', scores: { neuroticism: 2 } },
      { text: '中立', scores: { neuroticism: 3 } },
      { text: '同意', scores: { neuroticism: 4 } },
      { text: '非常同意', scores: { neuroticism: 5 } },
    ],
  },
  {
    q: '我的情绪容易波动',
    options: [
      { text: '非常不同意', scores: { neuroticism: 1 } },
      { text: '不同意', scores: { neuroticism: 2 } },
      { text: '中立', scores: { neuroticism: 3 } },
      { text: '同意', scores: { neuroticism: 4 } },
      { text: '非常同意', scores: { neuroticism: 5 } },
    ],
  },
];

const DIMENSIONS: { key: string; name: string; high: string; low: string }[] = [
  { key: 'openness', name: '开放性', high: '富有想象力、好奇心强、喜欢创新', low: '务实、传统、偏好熟悉的环境' },
  { key: 'conscientiousness', name: '尽责性', high: '自律、有条理、可靠负责', low: '灵活、自发、不太拘泥于规则' },
  { key: 'extraversion', name: '外向性', high: '热情、健谈、喜欢社交', low: '安静、内敛、享受独处' },
  { key: 'agreeableness', name: '宜人性', high: '友善、信任他人、乐于合作', low: '竞争性强、直接、注重自我利益' },
  { key: 'neuroticism', name: '神经质', high: '情绪敏感、容易焦虑', low: '情绪稳定、冷静沉着' },
];

const BigFiveTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  const getLevel = (score: number) => {
    const avg = score / 2;
    if (avg >= 4.5) return '非常高';
    if (avg >= 3.5) return '高';
    if (avg >= 2.5) return '中等';
    if (avg >= 1.5) return '低';
    return '非常低';
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">大五人格测试</h3>
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
          <p className="text-violet-400 font-semibold text-sm text-center mb-2">你的人格画像</p>
          {DIMENSIONS.map((dim) => {
            const score = scores[dim.key] || 0;
            const pct = (score / 10) * 100;
            const level = getLevel(score);
            const desc = (score / 2) >= 3 ? dim.high : dim.low;
            return (
              <div key={dim.key} className="space-y-1">
                <div className="flex justify-between items-center">
                  <span className="text-slate-200 text-xs">{dim.name}</span>
                  <span className="text-violet-400 text-xs font-bold">{level}</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-violet-600 h-2 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-slate-400 text-xs">{desc}</p>
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

export default BigFiveTest;
