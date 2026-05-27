import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '当伴侣没有及时回复消息时，我会感到不安',
    options: [
      { text: '非常同意', scores: { anxious: 3, secure: 0, avoidant: 0, fearful: 1 } },
      { text: '同意', scores: { anxious: 2, secure: 1, avoidant: 0, fearful: 1 } },
      { text: '不同意', scores: { anxious: 0, secure: 2, avoidant: 1, fearful: 1 } },
      { text: '非常不同意', scores: { anxious: 0, secure: 3, avoidant: 2, fearful: 0 } },
    ],
  },
  {
    q: '我觉得依赖别人是一件很自然的事',
    options: [
      { text: '非常同意', scores: { anxious: 1, secure: 3, avoidant: 0, fearful: 0 } },
      { text: '同意', scores: { anxious: 1, secure: 2, avoidant: 0, fearful: 1 } },
      { text: '不同意', scores: { anxious: 0, secure: 0, avoidant: 2, fearful: 2 } },
      { text: '非常不同意', scores: { anxious: 0, secure: 0, avoidant: 3, fearful: 1 } },
    ],
  },
  {
    q: '我害怕被伴侣抛弃或拒绝',
    options: [
      { text: '非常同意', scores: { anxious: 3, secure: 0, avoidant: 0, fearful: 3 } },
      { text: '同意', scores: { anxious: 2, secure: 1, avoidant: 0, fearful: 2 } },
      { text: '不同意', scores: { anxious: 0, secure: 2, avoidant: 1, fearful: 1 } },
      { text: '非常不同意', scores: { anxious: 0, secure: 3, avoidant: 2, fearful: 0 } },
    ],
  },
  {
    q: '在亲密关系中，我需要保持一定的个人空间',
    options: [
      { text: '非常同意', scores: { anxious: 0, secure: 1, avoidant: 3, fearful: 1 } },
      { text: '同意', scores: { anxious: 0, secure: 2, avoidant: 2, fearful: 1 } },
      { text: '不同意', scores: { anxious: 2, secure: 2, avoidant: 0, fearful: 1 } },
      { text: '非常不同意', scores: { anxious: 3, secure: 1, avoidant: 0, fearful: 2 } },
    ],
  },
  {
    q: '我能够坦诚地向伴侣表达自己的感受和需求',
    options: [
      { text: '非常同意', scores: { anxious: 1, secure: 3, avoidant: 0, fearful: 0 } },
      { text: '同意', scores: { anxious: 2, secure: 2, avoidant: 1, fearful: 0 } },
      { text: '不同意', scores: { anxious: 1, secure: 0, avoidant: 2, fearful: 2 } },
      { text: '非常不同意', scores: { anxious: 0, secure: 0, avoidant: 3, fearful: 3 } },
    ],
  },
  {
    q: '当关系变得太亲密时，我会想要退缩',
    options: [
      { text: '非常同意', scores: { anxious: 0, secure: 0, avoidant: 3, fearful: 3 } },
      { text: '同意', scores: { anxious: 0, secure: 1, avoidant: 2, fearful: 2 } },
      { text: '不同意', scores: { anxious: 2, secure: 2, avoidant: 0, fearful: 1 } },
      { text: '非常不同意', scores: { anxious: 3, secure: 3, avoidant: 0, fearful: 0 } },
    ],
  },
  {
    q: '我经常担心伴侣是否真的爱我',
    options: [
      { text: '非常同意', scores: { anxious: 3, secure: 0, avoidant: 0, fearful: 2 } },
      { text: '同意', scores: { anxious: 2, secure: 1, avoidant: 0, fearful: 2 } },
      { text: '不同意', scores: { anxious: 0, secure: 2, avoidant: 1, fearful: 1 } },
      { text: '非常不同意', scores: { anxious: 0, secure: 3, avoidant: 2, fearful: 0 } },
    ],
  },
  {
    q: '面对亲密关系中的冲突，我能冷静地沟通解决',
    options: [
      { text: '非常同意', scores: { anxious: 0, secure: 3, avoidant: 1, fearful: 0 } },
      { text: '同意', scores: { anxious: 1, secure: 2, avoidant: 1, fearful: 1 } },
      { text: '不同意', scores: { anxious: 2, secure: 0, avoidant: 1, fearful: 2 } },
      { text: '非常不同意', scores: { anxious: 3, secure: 0, avoidant: 2, fearful: 3 } },
    ],
  },
];

const TYPES: Record<string, { name: string; description: string }> = {
  secure: {
    name: '安全型依恋',
    description: '你在关系中感到舒适和自信。你能够信任伴侣，坦诚表达自己的需求，也能给予对方空间。你善于处理冲突，对关系有积极的期待。安全型依恋的人通常拥有更稳定、更满足的亲密关系。',
  },
  anxious: {
    name: '焦虑型依恋',
    description: '你在关系中容易感到不安，常常担心被抛弃。你渴望亲密和确认，有时会过度关注伴侣的行为。建议：学习自我安抚技巧，建立自我价值感，认识到自己值得被爱。与伴侣坦诚沟通你的需求，而不是通过试探来确认。',
  },
  avoidant: {
    name: '回避型依恋',
    description: '你重视独立和自主，可能对过度亲密感到不适。你习惯自己解决问题，不太愿意向他人寻求帮助。建议：尝试逐步向伴侣敞开心扉，认识到依赖他人并不等于失去自我。亲密和独立可以共存。',
  },
  fearful: {
    name: '恐惧型依恋',
    description: '你既渴望亲密又害怕受伤，在关系中常常感到矛盾。你可能经历过一些让你难以信任他人的经历。建议：首先学习接纳和理解自己的情绪，考虑寻求专业心理咨询的帮助。建立安全感需要时间和耐心。',
  },
};

const AttachmentStyleTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  const getResult = () => {
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'secure';
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  const resultKey = done ? getResult() : '';
  const resultData = TYPES[resultKey];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">恋爱依恋类型测试</h3>
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
            <p className="text-violet-400 font-bold text-lg mb-1">{resultData?.name}</p>
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3">
            <p className="text-slate-300 text-xs leading-relaxed">{resultData?.description}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs text-slate-400">各项得分：</p>
            {Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([key, val]) => {
              const maxScore = 24;
              return (
                <div key={key} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-16">{TYPES[key]?.name.replace('依恋', '')}</span>
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${key === resultKey ? 'bg-violet-600' : 'bg-slate-600'}`}
                      style={{ width: `${(val / maxScore) * 100}%` }}
                    />
                  </div>
                  <span className="text-xs text-slate-400 w-6 text-right">{val}</span>
                </div>
              );
            })}
          </div>
          <button onClick={restart} className="w-full bg-violet-600 hover:bg-violet-700 text-white text-sm py-2 rounded-lg transition-colors">
            重新测试
          </button>
        </div>
      )}
    </div>
  );
};

export default AttachmentStyleTest;
