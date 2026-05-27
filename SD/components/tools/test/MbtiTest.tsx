import React, { useState } from 'react';

interface Question {
  q: string;
  options: { text: string; scores: Record<string, number> }[];
}

const QUESTIONS: Question[] = [
  {
    q: '周末休息时，你更倾向于？',
    options: [
      { text: '和朋友出去聚会、社交', scores: { E: 1 } },
      { text: '一个人待在家里看书或看电影', scores: { I: 1 } },
    ],
  },
  {
    q: '在团队合作中，你通常扮演什么角色？',
    options: [
      { text: '主动组织讨论，带动气氛', scores: { E: 1 } },
      { text: '安静倾听，深思熟虑后发言', scores: { I: 1 } },
    ],
  },
  {
    q: '你更关注什么？',
    options: [
      { text: '具体的事实和细节', scores: { S: 1 } },
      { text: '事物背后的含义和可能性', scores: { N: 1 } },
    ],
  },
  {
    q: '你解决问题的方式更偏向？',
    options: [
      { text: '依靠已有的经验和实际方法', scores: { S: 1 } },
      { text: '尝试创新的、不同寻常的方式', scores: { N: 1 } },
    ],
  },
  {
    q: '做决定时，你更看重？',
    options: [
      { text: '逻辑分析和客观事实', scores: { T: 1 } },
      { text: '个人价值观和他人感受', scores: { F: 1 } },
    ],
  },
  {
    q: '当朋友向你倾诉烦恼时，你倾向于？',
    options: [
      { text: '帮TA分析问题，提出解决方案', scores: { T: 1 } },
      { text: '先表示理解和共情，给予情感支持', scores: { F: 1 } },
    ],
  },
  {
    q: '你的生活方式更偏向？',
    options: [
      { text: '喜欢提前计划，按部就班', scores: { J: 1 } },
      { text: '随机应变，灵活自由', scores: { P: 1 } },
    ],
  },
  {
    q: '对待截止日期，你通常？',
    options: [
      { text: '提前完成，不喜欢最后一刻的压力', scores: { J: 1 } },
      { text: '临近截止才开始，压力反而能激发效率', scores: { P: 1 } },
    ],
  },
  {
    q: '参加一个大型派对，你会？',
    options: [
      { text: '主动和很多人交流，享受热闹', scores: { E: 1 } },
      { text: '只和认识的人待在一起，很快就想离开', scores: { I: 1 } },
    ],
  },
  {
    q: '你更喜欢阅读什么类型的内容？',
    options: [
      { text: '写实的、基于事实的内容', scores: { S: 1 } },
      { text: '充满想象力和隐喻的内容', scores: { N: 1 } },
    ],
  },
  {
    q: '别人批评你时，你更在意？',
    options: [
      { text: '批评是否合理、有道理', scores: { T: 1 } },
      { text: '批评的方式是否伤人', scores: { F: 1 } },
    ],
  },
  {
    q: '旅行时你更喜欢？',
    options: [
      { text: '提前做好详细攻略和行程安排', scores: { J: 1 } },
      { text: '到了再说，随意探索', scores: { P: 1 } },
    ],
  },
];

const RESULTS: Record<string, { name: string; description: string }> = {
  INTJ: { name: 'INTJ - 建筑师', description: '富有想象力和战略性的思想家，一切皆在计划之中。独立、有远见，善于将复杂的想法转化为可执行的计划。' },
  INTP: { name: 'INTP - 逻辑学家', description: '具有创造力的发明家，对知识有永不满足的渴望。热爱理论和抽象思维，善于发现逻辑漏洞。' },
  ENTJ: { name: 'ENTJ - 指挥官', description: '大胆、富有想象力且意志坚强的领导者。天生的决策者，善于组织和推动团队达成目标。' },
  ENTP: { name: 'ENTP - 辩论家', description: '聪明好奇的思想家，不会放过任何智力挑战。喜欢从不同角度分析问题，享受思想碰撞。' },
  INFJ: { name: 'INFJ - 提倡者', description: '安静而神秘，同时鼓舞人心且不知疲倦的理想主义者。有强烈的使命感，关心他人的成长。' },
  INFP: { name: 'INFP - 调停者', description: '诗意、善良的利他主义者，总是热心为正义事业提供帮助。内心世界丰富，重视个人价值观。' },
  ENFJ: { name: 'ENFJ - 主人公', description: '富有魅力且鼓舞人心的领导者，能够迷住他的听众。天生的导师，善于激励他人发挥潜力。' },
  ENFP: { name: 'ENFP - 竞选者', description: '热情、有创造力、社交能力强的自由灵魂。充满好奇心，善于发现生活中各种可能性。' },
  ISTJ: { name: 'ISTJ - 物流师', description: '实际且注重事实的个人，其可靠性不容怀疑。做事有条不紊，重视传统和责任。' },
  ISFJ: { name: 'ISFJ - 守卫者', description: '非常专注且温暖的守护者，时刻准备着保护所爱的人。细心体贴，默默付出。' },
  ESTJ: { name: 'ESTJ - 总经理', description: '出色的管理者，在管理事物或人的方面无与伦比。注重秩序和效率，是天生的组织者。' },
  ESFJ: { name: 'ESFJ - 执政官', description: '非常关心他人的人，社交能力强，受欢迎。善于营造和谐氛围，重视人际关系。' },
  ISTP: { name: 'ISTP - 鉴赏家', description: '大胆而实际的实验家，擅长使用各种形式的工具。喜欢动手解决问题，享受独立探索。' },
  ISFP: { name: 'ISFP - 探险家', description: '灵活而有魅力的艺术家，时刻准备着探索新的可能性。感性、温和，享受当下的美好。' },
  ESTP: { name: 'ESTP - 企业家', description: '聪明、精力充沛且非常善于感知的人。喜欢冒险和行动，善于应对突发状况。' },
  ESFP: { name: 'ESFP - 表演者', description: '自发的、精力充沛的、热情的娱乐者。喜欢成为关注焦点，善于带动欢乐气氛。' },
};

const MbtiTest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
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
    const d1 = (scores.E || 0) >= (scores.I || 0) ? 'E' : 'I';
    const d2 = (scores.S || 0) >= (scores.N || 0) ? 'S' : 'N';
    const d3 = (scores.T || 0) >= (scores.F || 0) ? 'T' : 'F';
    const d4 = (scores.J || 0) >= (scores.P || 0) ? 'J' : 'P';
    return d1 + d2 + d3 + d4;
  };

  const resultType = done ? getResult() : '';
  const resultData = RESULTS[resultType];

  const restart = () => {
    setCurrent(0);
    setScores({});
    setDone(false);
  };

  return (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-violet-400 font-semibold text-sm">MBTI 趣味测试</h3>
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
            <p className="text-2xl font-bold text-violet-400 mb-1">{resultType}</p>
            <p className="text-slate-200 font-medium text-sm">{resultData?.name}</p>
          </div>
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-3">
            <p className="text-slate-300 text-xs leading-relaxed">{resultData?.description}</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(['E/I', 'S/N', 'T/F', 'J/P'] as const).map((dim, idx) => {
              const [a, b] = dim.split('/') as [string, string];
              const aVal = scores[a] || 0;
              const bVal = scores[b] || 0;
              const total = aVal + bVal || 1;
              return (
                <div key={dim} className="text-center">
                  <p className="text-xs text-slate-400 mb-1">{dim}</p>
                  <div className="flex items-center gap-1">
                    <span className={`text-xs font-bold ${aVal >= bVal ? 'text-violet-400' : 'text-slate-500'}`}>{a}</span>
                    <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                      <div className="bg-violet-600 h-1.5 rounded-full" style={{ width: `${(aVal / total) * 100}%` }} />
                    </div>
                    <span className={`text-xs font-bold ${bVal > aVal ? 'text-violet-400' : 'text-slate-500'}`}>{b}</span>
                  </div>
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

export default MbtiTest;
