import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const CompoundInterest: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [principal, setPrincipal] = useState('');
  const [rate, setRate] = useState('');
  const [years, setYears] = useState('');
  const [monthlyAdd, setMonthlyAdd] = useState('');
  const [result, setResult] = useState<{ finalAmount: string; totalEarnings: string; totalInvested: string } | null>(null);

  const calculate = () => {
    const p = parseFloat(principal);
    const r = parseFloat(rate);
    const y = parseFloat(years);
    const m = parseFloat(monthlyAdd) || 0;
    if (!p || !r || !y || p <= 0 || r <= 0 || y <= 0) return;

    const monthlyRate = r / 100 / 12;
    const totalMonths = y * 12;

    // 本金复利终值
    const principalFV = p * Math.pow(1 + monthlyRate, totalMonths);

    // 每月追加的复利终值 (年金终值公式)
    let addFV = 0;
    if (m > 0) {
      addFV = m * (Math.pow(1 + monthlyRate, totalMonths) - 1) / monthlyRate;
    }

    const finalAmount = principalFV + addFV;
    const totalInvested = p + m * totalMonths;
    const totalEarnings = finalAmount - totalInvested;

    setResult({
      finalAmount: finalAmount.toFixed(2),
      totalEarnings: totalEarnings.toFixed(2),
      totalInvested: totalInvested.toFixed(2),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">本金 (元)</label>
        <TextInput value={principal} onChange={setPrincipal} placeholder="请输入初始本金" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">年利率 (%)</label>
        <TextInput value={rate} onChange={setRate} placeholder="例如: 5" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">投资年限 (年)</label>
        <TextInput value={years} onChange={setYears} placeholder="例如: 10" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">每月追加 (元，可选)</label>
        <TextInput value={monthlyAdd} onChange={setMonthlyAdd} placeholder="0" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算复利</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="终值" value={`${result.finalAmount} 元`} onCopy={() => navigator.clipboard.writeText(result.finalAmount)} />
          <ResultBox label="总投入" value={`${result.totalInvested} 元`} />
          <ResultBox label="总收益" value={`${result.totalEarnings} 元`} />
        </div>
      )}
    </div>
  );
};

export default CompoundInterest;
