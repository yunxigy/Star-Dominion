import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; score: number }[];
}

const QUESTIONS: Question[] = [
  {
    q: '我经常把重要的事情拖到最后一刻才做',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '开始一项新任务时，我很难迈出第一步',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '我会用刷手机、看视频等方式逃避应该做的事情',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '我制定了计划但经常无法执行',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '面对复杂或困难的任务，我会选择先做简单的事情',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '我经常因为拖延而感到焦虑和自责',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '即使有充足的时间，我也会等到最后才开始',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '我会给自己找各种理由推迟行动',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '我经常在做事时分心，无法集中注意力',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
  {
    q: '截止日期是我完成任务的主要动力',
    options: [
      { text: '从不', score: 1 },
      { text: '偶尔', score: 2 },
      { text: '经常', score: 3 },
      { text: '总是', score: 4 },
    ],
  },
];

interface ResultLevel {
  name: string;
  range: string;
  description: string;
  tips: string[];
}

const RESULTS: ResultLevel[] = [
  {
    name: '轻度拖延',
    range: '10-17分',
    description: '你偶尔会拖延，但总体上能够管理好自己的时间。拖延对你的生活影响不大。',
    tips: ['继续保持良好的时间管理习惯', '可以尝试番茄工作法来提高效率', '给自己设定小奖励来保持动力'],
  },
  {
    name: '中度拖延',
    range: '18-25分',
    description: '你有一定的拖延倾向，可能会影响工作和学习效率。需要注意调整。',
    tips: ['将大任务分解成小步骤，降低启动难度', '设定明确的截止日期和阶段性目标', '减少环境中的干扰因素（如手机通知）', '找到一个互相监督的伙伴'],
  },
  {
    name: '重度拖延',
    range: '26-33分',
    description: '拖延已经明显影响了你的生活和工作。你可能经常感到焦虑和自责。',
    tips: ['优先处理最重要的任务（二八法则）', '使用"两分钟法则"——能两分钟完成的立刻做', '学习正念冥想，减少焦虑情绪', '考虑寻求专业的时间管理指导', '关注进步而非完美，接受"足够好"'],
  },
  {
    name: '严重拖延',
    range: '34-40分',
    description: '拖延已经成为你生活中的重大困扰。建议认真对待并采取行动改善。',
    tips: ['建议寻求心理咨询师的帮助', '从最小的行动开始，建立"行动惯性"', '识别拖延背后的深层原因（恐惧、完美主义等）', '建立外部问责机制', '对自己保持耐心和善意，改变需要时间'],
  },
];

const ProcrastinationTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [current, setCurrent] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const [done, setDone] = useState(false);

  const handleAnswer = (optionIndex: number) => {
    const option = QUESTIONS[current].options[optionIndex];
    const newScore = totalScore + option.score;
    setTotalScore(newScore);
    if (current < QUESTIONS.length - 1) {
      setCurrent(current + 1);
    } else {
      setDone(true);
    }
  };

  const getResult = () => {
    if (totalScore <= 17) return RESULTS[0];
    if (totalScore <= 25) return RESULTS[1];
    if (totalScore <= 33) return RESULTS[2];
    return RESULTS[3];
  };

  const restart = () => {
    setCurrent(0);
    setTotalScore(0);
    setDone(false);
  };

  const result = done ? getResult() : null;
  const pct = (totalScore / 40) * 100;

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">拖延症测试</h3>
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
            <p className="text-xs text-slate-400">总分 40 分</p>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${pct <= 42 ? 'bg-green-500' : pct <= 62 ? 'bg-yellow-500' : pct <= 82 ? 'bg-orange-500' : 'bg-red-500'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-center">
            <p className="text-violet-400 font-bold text-lg">{result?.name}</p>
            <p className="text-xs text-slate-400">{result?.range}</p>
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3">
            <p className="text-slate-300 text-xs leading-relaxed mb-2">{result?.description}</p>
            <p className="text-violet-400 text-xs font-semibold mb-1">改善建议：</p>
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

export default ProcrastinationTest;
