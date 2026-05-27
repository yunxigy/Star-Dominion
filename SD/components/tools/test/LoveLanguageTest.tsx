import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '当伴侣对我说"我爱你"或赞美我时，我感到特别幸福',
    options: [
      { text: '非常符合', scores: { words: 3 } },
      { text: '比较符合', scores: { words: 2 } },
      { text: '不太符合', scores: { words: 1 } },
      { text: '完全不符合', scores: { words: 0 } },
    ],
  },
  {
    q: '收到伴侣手写的信或温馨的短信让我感到被爱',
    options: [
      { text: '非常符合', scores: { words: 3 } },
      { text: '比较符合', scores: { words: 2 } },
      { text: '不太符合', scores: { words: 1 } },
      { text: '完全不符合', scores: { words: 0 } },
    ],
  },
  {
    q: '和伴侣一起度过高质量的时光（如散步、聊天）是我最珍惜的',
    options: [
      { text: '非常符合', scores: { time: 3 } },
      { text: '比较符合', scores: { time: 2 } },
      { text: '不太符合', scores: { time: 1 } },
      { text: '完全不符合', scores: { time: 0 } },
    ],
  },
  {
    q: '当伴侣放下手机专注陪伴我时，我感到被重视',
    options: [
      { text: '非常符合', scores: { time: 3 } },
      { text: '比较符合', scores: { time: 2 } },
      { text: '不太符合', scores: { time: 1 } },
      { text: '完全不符合', scores: { time: 0 } },
    ],
  },
  {
    q: '收到伴侣精心挑选的礼物会让我非常感动',
    options: [
      { text: '非常符合', scores: { gifts: 3 } },
      { text: '比较符合', scores: { gifts: 2 } },
      { text: '不太符合', scores: { gifts: 1 } },
      { text: '完全不符合', scores: { gifts: 0 } },
    ],
  },
  {
    q: '即使是很小的礼物或纪念品，只要是伴侣送的我就很珍惜',
    options: [
      { text: '非常符合', scores: { gifts: 3 } },
      { text: '比较符合', scores: { gifts: 2 } },
      { text: '不太符合', scores: { gifts: 1 } },
      { text: '完全不符合', scores: { gifts: 0 } },
    ],
  },
  {
    q: '当伴侣主动帮我做事（如做饭、打扫）时，我感到被爱',
    options: [
      { text: '非常符合', scores: { service: 3 } },
      { text: '比较符合', scores: { service: 2 } },
      { text: '不太符合', scores: { service: 1 } },
      { text: '完全不符合', scores: { service: 0 } },
    ],
  },
  {
    q: '伴侣为我分担压力和责任让我觉得TA很爱我',
    options: [
      { text: '非常符合', scores: { service: 3 } },
      { text: '比较符合', scores: { service: 2 } },
      { text: '不太符合', scores: { service: 1 } },
      { text: '完全不符合', scores: { service: 0 } },
    ],
  },
  {
    q: '拥抱、牵手、亲吻等身体接触让我感到安心和被爱',
    options: [
      { text: '非常符合', scores: { touch: 3 } },
      { text: '比较符合', scores: { touch: 2 } },
      { text: '不太符合', scores: { touch: 1 } },
      { text: '完全不符合', scores: { touch: 0 } },
    ],
  },
  {
    q: '伴侣轻拍我的肩膀或靠在我身边会让我感到温暖',
    options: [
      { text: '非常符合', scores: { touch: 3 } },
      { text: '比较符合', scores: { touch: 2 } },
      { text: '不太符合', scores: { touch: 1 } },
      { text: '完全不符合', scores: { touch: 0 } },
    ],
  },
];

const LANGUAGES: Record<string, { name: string; description: string }> = {
  words: { name: '肯定的言辞', description: '你通过语言表达和接收爱。真诚的赞美、鼓励的话语、爱的表达对你来说意义重大。建议：多用语言表达爱意，写温馨的便条，经常给予肯定和鼓励。' },
  time: { name: '精心的时刻', description: '你通过专注的陪伴感受爱。全身心的关注和共度时光对你来说最重要。建议：安排专属的约会时间，放下手机，专注地倾听和互动。' },
  gifts: { name: '接受礼物', description: '你通过礼物感受爱意。不在于礼物的价值，而在于背后的心意和纪念意义。建议：记住重要的日子，偶尔送一些有心意的小礼物。' },
  service: { name: '服务的行动', description: '你通过实际行动感受爱。伴侣为你做事、分担责任让你感到被珍惜。建议：主动为对方做一些力所能及的事情，用行动表达关心。' },
  touch: { name: '身体的接触', description: '你通过身体接触感受爱。拥抱、牵手、亲吻等肢体接触让你感到安全和被爱。建议：增加日常的肢体接触，如牵手、拥抱、轻拍肩膀等。' },
};

const LoveLanguageTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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

  const getRanking = () => {
    return Object.entries(scores).sort((a, b) => b[1] - a[1]);
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  const ranking = done ? getRanking() : [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">爱情语言测试</h3>
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
          <p className="text-violet-400 font-semibold text-sm text-center">你的爱情语言排名</p>
          {ranking.map(([key, val], idx) => {
            const lang = LANGUAGES[key];
            const maxScore = 6;
            return (
              <div key={key} className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold ${idx === 0 ? 'bg-violet-600 text-white' : 'bg-slate-700 text-slate-400'}`}>
                    #{idx + 1}
                  </span>
                  <span className={`font-semibold text-sm ${idx === 0 ? 'text-violet-400' : 'text-slate-300'}`}>{lang?.name}</span>
                  <span className="text-xs text-slate-500 ml-auto">{val}/{maxScore}</span>
                </div>
                <div className="w-full bg-slate-700 rounded-full h-1.5">
                  <div
                    className={`h-1.5 rounded-full transition-all ${idx === 0 ? 'bg-violet-600' : 'bg-slate-600'}`}
                    style={{ width: `${(val / maxScore) * 100}%` }}
                  />
                </div>
                {idx === 0 && (
                  <p className="text-slate-300 text-xs leading-relaxed">{lang?.description}</p>
                )}
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

export default LoveLanguageTest;
