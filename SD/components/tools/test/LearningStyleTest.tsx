import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '学习新知识时，我更喜欢通过看图表、视频等视觉材料',
    options: [
      { text: '非常符合', scores: { visual: 3 } },
      { text: '比较符合', scores: { visual: 2 } },
      { text: '不太符合', scores: { visual: 1 } },
      { text: '完全不符合', scores: { visual: 0 } },
    ],
  },
  {
    q: '我能通过回忆脑海中的画面来记住信息',
    options: [
      { text: '非常符合', scores: { visual: 3 } },
      { text: '比较符合', scores: { visual: 2 } },
      { text: '不太符合', scores: { visual: 1 } },
      { text: '完全不符合', scores: { visual: 0 } },
    ],
  },
  {
    q: '我更喜欢听讲解、讨论或录音来学习',
    options: [
      { text: '非常符合', scores: { auditory: 3 } },
      { text: '比较符合', scores: { auditory: 2 } },
      { text: '不太符合', scores: { auditory: 1 } },
      { text: '完全不符合', scores: { auditory: 0 } },
    ],
  },
  {
    q: '我喜欢通过讨论和交流来理解新概念',
    options: [
      { text: '非常符合', scores: { auditory: 3 } },
      { text: '比较符合', scores: { auditory: 2 } },
      { text: '不太符合', scores: { auditory: 1 } },
      { text: '完全不符合', scores: { auditory: 0 } },
    ],
  },
  {
    q: '我通过动手实践和亲身体验学得最好',
    options: [
      { text: '非常符合', scores: { kinesthetic: 3 } },
      { text: '比较符合', scores: { kinesthetic: 2 } },
      { text: '不太符合', scores: { kinesthetic: 1 } },
      { text: '完全不符合', scores: { kinesthetic: 0 } },
    ],
  },
  {
    q: '学习时我喜欢走动或使用手势来帮助理解',
    options: [
      { text: '非常符合', scores: { kinesthetic: 3 } },
      { text: '比较符合', scores: { kinesthetic: 2 } },
      { text: '不太符合', scores: { kinesthetic: 1 } },
      { text: '完全不符合', scores: { kinesthetic: 0 } },
    ],
  },
  {
    q: '我更喜欢通过阅读文字材料和做笔记来学习',
    options: [
      { text: '非常符合', scores: { reading: 3 } },
      { text: '比较符合', scores: { reading: 2 } },
      { text: '不太符合', scores: { reading: 1 } },
      { text: '完全不符合', scores: { reading: 0 } },
    ],
  },
  {
    q: '列提纲和整理笔记是我最有效的学习方式',
    options: [
      { text: '非常符合', scores: { reading: 3 } },
      { text: '比较符合', scores: { reading: 2 } },
      { text: '不太符合', scores: { reading: 1 } },
      { text: '完全不符合', scores: { reading: 0 } },
    ],
  },
];

const STYLES: Record<string, { name: string; description: string; tips: string[] }> = {
  visual: {
    name: '视觉型学习者',
    description: '你通过图像、颜色和空间关系来学习效果最好。你的大脑对视觉信息的处理能力很强。',
    tips: [
      '使用思维导图整理知识结构',
      '用不同颜色的笔标记重点内容',
      '多看图表、流程图和示意图',
      '将抽象概念转化为具体的图像',
      '观看教学视频和演示',
    ],
  },
  auditory: {
    name: '听觉型学习者',
    description: '你通过听和说来学习效果最好。声音、节奏和语言是你的主要学习通道。',
    tips: [
      '大声朗读学习材料',
      '参加讨论和学习小组',
      '听录音、播客和有声书',
      '用口诀和韵律帮助记忆',
      '向他人讲解所学内容（教是最好的学）',
    ],
  },
  kinesthetic: {
    name: '动觉型学习者',
    description: '你通过身体的运动和实际操作来学习效果最好。你需要在学习中动起来。',
    tips: [
      '通过实验和实践来学习',
      '学习时适当走动或使用减压球',
      '制作模型或实物来理解概念',
      '将学习内容与身体动作关联',
      '在户外或不同环境中学习',
    ],
  },
  reading: {
    name: '阅读型学习者',
    description: '你通过阅读文字和书写笔记来学习效果最好。文字是你的主要学习通道。',
    tips: [
      '多做笔记，用自己的话重写要点',
      '将学习内容整理成文字总结',
      '制作闪卡和复习清单',
      '阅读教材和参考书籍',
      '通过写作来整理和巩固知识',
    ],
  },
};

const LearningStyleTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
    return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'visual';
  };

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  const dominant = done ? getDominant() : '';
  const resultData = STYLES[dominant];
  const allStyles = done ? Object.entries(scores).sort((a, b) => b[1] - a[1]) : [];

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">学习风格测试</h3>
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
          <p className="text-violet-400 font-semibold text-sm text-center">你的学习风格</p>
          <div className="space-y-2">
            {allStyles.map(([key, val], idx) => {
              const style = STYLES[key];
              return (
                <div key={key} className="bg-slate-700/30 border border-slate-600 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    {idx === 0 && (
                      <span className="bg-violet-600 text-white text-xs px-2 py-0.5 rounded-full">主导</span>
                    )}
                    <span className={`font-semibold text-sm ${idx === 0 ? 'text-violet-400' : 'text-slate-300'}`}>
                      {style?.name}
                    </span>
                    <span className="text-xs text-slate-500 ml-auto">{val}/6</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full transition-all ${idx === 0 ? 'bg-violet-600' : 'bg-slate-600'}`}
                      style={{ width: `${(val / 6) * 100}%` }}
                    />
                  </div>
                  {idx === 0 && resultData && (
                    <>
                      <p className="text-slate-300 text-xs leading-relaxed">{resultData.description}</p>
                      <p className="text-violet-400 text-xs font-semibold mt-1">学习建议：</p>
                      <ul className="space-y-1">
                        {resultData.tips.map((tip, i) => (
                          <li key={i} className="text-slate-300 text-xs flex items-start gap-1">
                            <span className="text-violet-400 mt-0.5">-</span>
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
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

export default LearningStyleTest;
