import React, { useState } from 'react';
import { Btn, ResultBox } from '../shared';

const DateDiffCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [result, setResult] = useState<{ days: number; workdays: number; weeks: string } | null>(null);

  const calculate = () => {
    if (!startDate || !endDate) return;
    const d1 = new Date(startDate);
    const d2 = new Date(endDate);

    const diffTime = Math.abs(d2.getTime() - d1.getTime());
    const days = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const weeks = (days / 7).toFixed(1);

    // 计算工作日
    let workdays = 0;
    const start = d1 < d2 ? d1 : d2;
    const end = d1 < d2 ? d2 : d1;
    const current = new Date(start);
    while (current <= end) {
      const day = current.getDay();
      if (day !== 0 && day !== 6) workdays++;
      current.setDate(current.getDate() + 1);
    }

    setResult({ days, workdays, weeks });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">起始日期</label>
        <input
          type="date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">结束日期</label>
        <input
          type="date"
          value={endDate}
          onChange={e => setEndDate(e.target.value)}
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
        />
      </div>
      <Btn onClick={calculate} variant="primary">计算间隔</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="天数差" value={`${result.days} 天`} onCopy={() => navigator.clipboard.writeText(String(result.days))} />
          <ResultBox label="工作日差" value={`${result.workdays} 天`} />
          <ResultBox label="周数差" value={`${result.weeks} 周`} />
        </div>
      )}
    </div>
  );
};

export default DateDiffCalculator;
