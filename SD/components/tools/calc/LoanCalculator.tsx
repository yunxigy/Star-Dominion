import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

const LoanCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');
  const [result, setResult] = useState<{ monthly: string; totalInterest: string; totalPayment: string } | null>(null);

  const calculate = () => {
    const principal = parseFloat(amount);
    const annualRate = parseFloat(rate);
    const totalMonths = parseInt(months, 10);
    if (!principal || !annualRate || !totalMonths || principal <= 0 || annualRate <= 0 || totalMonths <= 0) return;

    const monthlyRate = annualRate / 100 / 12;
    const monthly = principal * monthlyRate * Math.pow(1 + monthlyRate, totalMonths) / (Math.pow(1 + monthlyRate, totalMonths) - 1);
    const totalPayment = monthly * totalMonths;
    const totalInterest = totalPayment - principal;

    setResult({
      monthly: monthly.toFixed(2),
      totalInterest: totalInterest.toFixed(2),
      totalPayment: totalPayment.toFixed(2),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">贷款金额 (元)</label>
        <TextInput value={amount} onChange={setAmount} placeholder="请输入贷款金额" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">年利率 (%)</label>
        <TextInput value={rate} onChange={setRate} placeholder="例如: 4.9" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">贷款期限 (月)</label>
        <TextInput value={months} onChange={setMonths} placeholder="例如: 360" type="number" />
      </div>
      <Btn onClick={calculate} variant="primary">计算月供</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="每月月供" value={`${result.monthly} 元`} onCopy={() => navigator.clipboard.writeText(result.monthly)} />
          <ResultBox label="总利息" value={`${result.totalInterest} 元`} />
          <ResultBox label="总还款额" value={`${result.totalPayment} 元`} />
        </div>
      )}
    </div>
  );
};

export default LoanCalculator;
