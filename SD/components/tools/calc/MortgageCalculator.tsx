import React, { useState } from 'react';
import { Btn, TextInput, ResultBox } from '../shared';

type Method = 'equal_payment' | 'equal_principal';

const MortgageCalculator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [price, setPrice] = useState('');
  const [downRatio, setDownRatio] = useState('');
  const [rate, setRate] = useState('');
  const [months, setMonths] = useState('');
  const [method, setMethod] = useState<Method>('equal_payment');
  const [result, setResult] = useState<{
    loanAmount: string;
    monthlyFirst: string;
    monthlyLast?: string;
    totalInterest: string;
    totalPayment: string;
  } | null>(null);

  const calculate = () => {
    const p = parseFloat(price);
    const dr = parseFloat(downRatio);
    const annualRate = parseFloat(rate);
    const totalMonths = parseInt(months, 10);
    if (!p || isNaN(dr) || !annualRate || !totalMonths || p <= 0 || dr < 0 || dr > 100 || annualRate <= 0 || totalMonths <= 0) return;

    const loanAmount = p * (1 - dr / 100);
    const monthlyRate = annualRate / 100 / 12;

    if (method === 'equal_payment') {
      // 等额本息
      const monthly = loanAmount * monthlyRate * Math.pow(1 + monthlyRate, totalMonths) / (Math.pow(1 + monthlyRate, totalMonths) - 1);
      const totalPayment = monthly * totalMonths;
      const totalInterest = totalPayment - loanAmount;
      setResult({
        loanAmount: loanAmount.toFixed(2),
        monthlyFirst: monthly.toFixed(2),
        totalInterest: totalInterest.toFixed(2),
        totalPayment: totalPayment.toFixed(2),
      });
    } else {
      // 等额本金
      const monthlyPrincipal = loanAmount / totalMonths;
      const firstMonthInterest = loanAmount * monthlyRate;
      const firstMonthly = monthlyPrincipal + firstMonthInterest;
      const lastMonthInterest = monthlyPrincipal * monthlyRate;
      const lastMonthly = monthlyPrincipal + lastMonthInterest;
      const totalInterest = (totalMonths + 1) * loanAmount * monthlyRate / 2;
      const totalPayment = loanAmount + totalInterest;
      setResult({
        loanAmount: loanAmount.toFixed(2),
        monthlyFirst: firstMonthly.toFixed(2),
        monthlyLast: lastMonthly.toFixed(2),
        totalInterest: totalInterest.toFixed(2),
        totalPayment: totalPayment.toFixed(2),
      });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-slate-400 mb-1">房价 (元)</label>
        <TextInput value={price} onChange={setPrice} placeholder="请输入房价" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">首付比例 (%)</label>
        <TextInput value={downRatio} onChange={setDownRatio} placeholder="例如: 30" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">年利率 (%)</label>
        <TextInput value={rate} onChange={setRate} placeholder="例如: 4.9" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">贷款期限 (月)</label>
        <TextInput value={months} onChange={setMonths} placeholder="例如: 360" type="number" />
      </div>
      <div>
        <label className="block text-xs text-slate-400 mb-1">还款方式</label>
        <div className="flex gap-2">
          <button
            onClick={() => setMethod('equal_payment')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              method === 'equal_payment' ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
            }`}
          >
            等额本息
          </button>
          <button
            onClick={() => setMethod('equal_principal')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              method === 'equal_principal' ? 'bg-violet-600 text-white' : 'bg-slate-800/50 text-slate-400 border border-slate-700'
            }`}
          >
            等额本金
          </button>
        </div>
      </div>
      <Btn onClick={calculate} variant="primary">计算房贷</Btn>
      {result && (
        <div className="space-y-2">
          <ResultBox label="贷款金额" value={`${result.loanAmount} 元`} />
          <ResultBox label={method === 'equal_payment' ? '每月月供' : '首月月供'} value={`${result.monthlyFirst} 元`} onCopy={() => navigator.clipboard.writeText(result.monthlyFirst)} />
          {result.monthlyLast && <ResultBox label="末月月供" value={`${result.monthlyLast} 元`} />}
          <ResultBox label="总利息" value={`${result.totalInterest} 元`} />
          <ResultBox label="总还款额" value={`${result.totalPayment} 元`} />
        </div>
      )}
    </div>
  );
};

export default MortgageCalculator;
