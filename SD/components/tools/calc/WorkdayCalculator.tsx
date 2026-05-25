import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const WorkdayCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [startDate, setStartDate] = useState('');
  const [workdays, setWorkdays] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const calculate = () => {
    if (!startDate || !workdays) return;
    const days = parseInt(workdays, 10);
    if (isNaN(days) || days <= 0) return;

    const current = new Date(startDate);
    let remaining = days;

    while (remaining > 0) {
      current.setDate(current.getDate() + 1);
      const day = current.getDay();
      if (day !== 0 && day !== 6) remaining--;
    }

    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekDay = weekDays[current.getDay()];

    setResult(`${year}-${month}-${day} (星期${weekDay})`);
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
        <label className="block text-xs text-slate-400 mb-1">工作日数量</label>
        <TextInput value={workdays} onChange={setWorkdays} placeholder="请输入工作日数量" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算结束日期</Btn>
      {result && (
        <ResultBox label="结束日期" value={result} onCopy={() => navigator.clipboard.writeText(result)} />
      )}
    </div>
  );
};

export default WorkdayCalculator;
