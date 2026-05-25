import React, { useState } from 'react';
import { Btn, ResultBox } from '../shared';

const zodiacSigns = [
  { name: '摩羯座', start: [1, 1], end: [1, 19] },
  { name: '水瓶座', start: [1, 20], end: [2, 18] },
  { name: '双鱼座', start: [2, 19], end: [3, 20] },
  { name: '白羊座', start: [3, 21], end: [4, 19] },
  { name: '金牛座', start: [4, 20], end: [5, 20] },
  { name: '双子座', start: [5, 21], end: [6, 21] },
  { name: '巨蟹座', start: [6, 22], end: [7, 22] },
  { name: '狮子座', start: [7, 23], end: [8, 22] },
  { name: '处女座', start: [8, 23], end: [9, 22] },
  { name: '天秤座', start: [9, 23], end: [10, 23] },
  { name: '天蝎座', start: [10, 24], end: [11, 22] },
  { name: '射手座', start: [11, 23], end: [12, 21] },
  { name: '摩羯座', start: [12, 22], end: [12, 31] },
];

const chineseZodiac = ['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪'];

const AgeCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [birthDate, setBirthDate] = useState('');
  const [result, setResult] = useState<{ years: number; months: number; days: number; zodiac: string; chineseZodiac: string } | null>(null);

  const calculate = () => {
    if (!birthDate) return;
    const birth = new Date(birthDate);
    const now = new Date();
    if (birth > now) return;

    let years = now.getFullYear() - birth.getFullYear();
    let months = now.getMonth() - birth.getMonth();
    let days = now.getDate() - birth.getDate();

    if (days < 0) {
      months--;
      const lastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      days += lastMonth.getDate();
    }
    if (months < 0) {
      years--;
      months += 12;
    }

    // 星座
    const m = birth.getMonth() + 1;
    const d = birth.getDate();
    const zodiac = zodiacSigns.find(z => {
      const [sm, sd] = z.start;
      const [em, ed] = z.end;
      return (m === sm && d >= sd) || (m === em && d <= ed);
    })?.name || '未知';

    // 生肖
    const cz = chineseZodiac[(birth.getFullYear() - 4) % 12];

    setResult({ years, months, days, zodiac, chineseZodiac: cz });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">出生日期</label>
        <input
          type="date"
          value={birthDate}
          onChange={e => setBirthDate(e.target.value)}
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      </div>
      <Btn onClick={calculate} variant="primary">计算年龄</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="年龄" value={`${result.years} 岁 ${result.months} 个月 ${result.days} 天`} />
          <ResultBox label="星座" value={result.zodiac} />
          <ResultBox label="生肖" value={result.chineseZodiac} />
        </div>
      )}
    </div>
  );
};

export default AgeCalculator;
